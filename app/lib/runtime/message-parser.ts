import type { ActionType, BeamCoreAction, BeamCoreActionData, FileAction, ShellAction } from '~/types/actions';
import type { BeamCoreProjectData } from '~/types/artifact';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';

const PROJECT_TAG_OPEN = '<beamcoreProject';
const LEGACY_PROJECT_TAG_OPEN = '<boltArtifact';
const PROJECT_TAG_CLOSES = ['</beamcoreProject>', '</boltArtifact>'];
const PROJECT_ACTION_TAG_OPENS = ['<beamcoreAction', '<boltAction'];
const PROJECT_ACTION_TAG_CLOSES = ['</beamcoreAction>', '</boltAction>'];
const PROJECT_TAG_OPENS = [PROJECT_TAG_OPEN, LEGACY_PROJECT_TAG_OPEN];

const logger = createScopedLogger('MessageParser');

interface TagMatch {
  index: number;
  tag: string;
}

function findNextTag(input: string, start: number, tags: string[]): TagMatch | undefined {
  let match: TagMatch | undefined;

  for (const tag of tags) {
    const index = input.indexOf(tag, start);

    if (index !== -1 && (!match || index < match.index)) {
      match = { index, tag };
    }
  }

  return match;
}

export interface ProjectCallbackData extends BeamCoreProjectData {
  messageId: string;
}

export interface ActionCallbackData {
  artifactId: string;
  messageId: string;
  actionId: string;
  action: BeamCoreAction;
}

export type ProjectCallback = (data: ProjectCallbackData) => void;
/** @deprecated Use ProjectCallbackData. */
export type ArtifactCallbackData = ProjectCallbackData;
/** @deprecated Use ProjectCallback. */
export type ArtifactCallback = ProjectCallback;
export type ActionCallback = (data: ActionCallbackData) => void;

export interface ParserCallbacks {
  onProjectOpen?: ProjectCallback;
  onProjectClose?: ProjectCallback;
  /** @deprecated Legacy callback aliases for older integrations. */
  onArtifactOpen?: ProjectCallback;
  onArtifactClose?: ProjectCallback;
  onActionOpen?: ActionCallback;
  onActionClose?: ActionCallback;
}

interface ElementFactoryProps {
  messageId: string;
}

type ElementFactory = (props: ElementFactoryProps) => string;

export interface StreamingMessageParserOptions {
  callbacks?: ParserCallbacks;
  projectElement?: ElementFactory;
  /** @deprecated Use projectElement. */
  artifactElement?: ElementFactory;
}

interface MessageState {
  position: number;
  insideProject: boolean;
  insideAction: boolean;
  currentProject?: BeamCoreProjectData;
  currentAction: BeamCoreActionData;
  actionId: number;
}

export class StreamingMessageParser {
  #messages = new Map<string, MessageState>();

  constructor(private _options: StreamingMessageParserOptions = {}) {}

  parse(messageId: string, input: string) {
    let state = this.#messages.get(messageId);

    if (!state) {
      state = {
        position: 0,
        insideAction: false,
        insideProject: false,
        currentAction: { content: '' },
        actionId: 0,
      };

      this.#messages.set(messageId, state);
    }

    let output = '';
    let i = state.position;
    let earlyBreak = false;

    while (i < input.length) {
      if (state.insideProject) {
        const currentProject = state.currentProject;

        if (currentProject === undefined) {
          unreachable('Project not initialized');
        }

        if (state.insideAction) {
          const closeMatch = findNextTag(input, i, PROJECT_ACTION_TAG_CLOSES);
          const currentAction = state.currentAction;

          if (closeMatch) {
            currentAction.content += input.slice(i, closeMatch.index);

            let content = currentAction.content.trim();

            if ('type' in currentAction && currentAction.type === 'file') {
              content += '\n';
            }

            currentAction.content = content;

            this._options.callbacks?.onActionClose?.({
              artifactId: currentProject.id,
              messageId,
              actionId: String(state.actionId - 1),
              action: currentAction as BeamCoreAction,
            });

            state.insideAction = false;
            state.currentAction = { content: '' };
            i = closeMatch.index + closeMatch.tag.length;
          } else {
            break;
          }
        } else {
          const actionOpenMatch = findNextTag(input, i, PROJECT_ACTION_TAG_OPENS);
          const projectCloseMatch = findNextTag(input, i, PROJECT_TAG_CLOSES);

          if (actionOpenMatch && (!projectCloseMatch || actionOpenMatch.index < projectCloseMatch.index)) {
            const actionEndIndex = input.indexOf('>', actionOpenMatch.index);

            if (actionEndIndex !== -1) {
              state.insideAction = true;
              state.currentAction = this.#parseActionTag(input, actionOpenMatch.index, actionEndIndex);

              this._options.callbacks?.onActionOpen?.({
                artifactId: currentProject.id,
                messageId,
                actionId: String(state.actionId++),
                action: state.currentAction as BeamCoreAction,
              });

              i = actionEndIndex + 1;
            } else {
              break;
            }
          } else if (projectCloseMatch) {
            (this._options.callbacks?.onProjectClose ?? this._options.callbacks?.onArtifactClose)?.({
              messageId,
              ...currentProject,
            });

            state.insideProject = false;
            state.currentProject = undefined;
            i = projectCloseMatch.index + projectCloseMatch.tag.length;
          } else {
            break;
          }
        }
      } else if (input[i] === '<' && input[i + 1] !== '/') {
        let j = i;
        let potentialTag = '';

        while (j < input.length && potentialTag.length < PROJECT_TAG_OPEN.length) {
          potentialTag += input[j];

          const matchingOpenTag = PROJECT_TAG_OPENS.find(
            (tag) => tag.toLowerCase() === potentialTag.toLowerCase(),
          );

          if (matchingOpenTag) {
            const nextChar = input[j + 1];

            if (nextChar && nextChar !== '>' && !/\s/.test(nextChar)) {
              output += input.slice(i, j + 1);
              i = j + 1;
              break;
            }

            const openTagEnd = input.indexOf('>', j);

            if (openTagEnd !== -1) {
              const projectTag = input.slice(i, openTagEnd + 1);
              const projectTitle = this.#extractAttribute(projectTag, 'title') as string;
              const projectId = this.#extractAttribute(projectTag, 'id') as string;

              if (!projectTitle) {
                logger.warn('Project title missing');
              }

              if (!projectId) {
                logger.warn('Project id missing');
              }

              state.insideProject = true;

              const currentProject = {
                id: projectId,
                title: projectTitle,
              } satisfies BeamCoreProjectData;

              state.currentProject = currentProject;

              (this._options.callbacks?.onProjectOpen ?? this._options.callbacks?.onArtifactOpen)?.({
                messageId,
                ...currentProject,
              });

              const projectFactory = this._options.projectElement ?? this._options.artifactElement ?? createProjectElement;
              output += projectFactory({ messageId });
              i = openTagEnd + 1;
            } else {
              earlyBreak = true;
            }

            break;
          } else if (!PROJECT_TAG_OPENS.some((tag) => tag.toLowerCase().startsWith(potentialTag.toLowerCase()))) {
            output += input.slice(i, j + 1);
            i = j + 1;
            break;
          }

          j++;
        }

        if (
          j === input.length &&
          PROJECT_TAG_OPENS.some((tag) => tag.toLowerCase().startsWith(potentialTag.toLowerCase()))
        ) {
          break;
        }
      } else {
        output += input[i];
        i++;
      }

      if (earlyBreak) {
        break;
      }
    }

    state.position = i;

    return output;
  }

  reset() {
    this.#messages.clear();
  }

  #parseActionTag(input: string, actionOpenIndex: number, actionEndIndex: number) {
    const actionTag = input.slice(actionOpenIndex, actionEndIndex + 1);
    const actionType = this.#extractAttribute(actionTag, 'type') as ActionType;

    const actionAttributes = {
      type: actionType,
      content: '',
    };

    if (actionType === 'file') {
      const filePath = this.#extractAttribute(actionTag, 'filePath') as string;

      if (!filePath) {
        logger.debug('File path not specified');
      }

      (actionAttributes as FileAction).filePath = filePath;
    } else if (actionType !== 'shell') {
      logger.warn(`Unknown action type '${actionType}'`);
    }

    return actionAttributes as FileAction | ShellAction;
  }

  #extractAttribute(tag: string, attributeName: string): string | undefined {
    const match = tag.match(new RegExp(`${attributeName}="([^"]*)"`, 'i'));
    return match ? match[1] : undefined;
  }
}

const createProjectElement: ElementFactory = (props) => {
  const elementProps = [
    'class="__beamcoreProject__"',
    ...Object.entries(props).map(([key, value]) => {
      return `data-${camelToDashCase(key)}=${JSON.stringify(value)}`;
    }),
  ];

  return `<div ${elementProps.join(' ')}></div>`;
};

function camelToDashCase(input: string) {
  return input.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
