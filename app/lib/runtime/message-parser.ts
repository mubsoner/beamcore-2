import type { ActionType, BeamCoreAction, BeamCoreActionData, FileAction, ShellAction } from '~/types/actions';
import type { BeamCoreProjectData } from '~/types/artifact';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';

const PROJECT_TAG_OPEN = '<beamcoreProject';
const PROJECT_TAG_CLOSE = '</beamcoreProject>';
const PROJECT_ACTION_TAG_OPEN = '<beamcoreAction';
const PROJECT_ACTION_TAG_CLOSE = '</beamcoreAction>';

const logger = createScopedLogger('MessageParser');

export interface ProjectCallbackData extends BeamCoreProjectData {
  messageId: string;
}

export interface ActionCallbackData {
  projectId: string;
  messageId: string;
  actionId: string;
  action: BeamCoreAction;
}

export type ProjectCallback = (data: ProjectCallbackData) => void;
export type ActionCallback = (data: ActionCallbackData) => void;

export interface ParserCallbacks {
  onProjectOpen?: ProjectCallback;
  onProjectClose?: ProjectCallback;
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
    // Normalize legacy Bolt tags to the native BeamCore protocol so saved conversations remain readable.
    const normalizedInput = input
      .split('<boltArtifact').join('<beamcoreProject')
      .split('</boltArtifact>').join('</beamcoreProject>')
      .split('<boltAction').join('<beamcoreAction')
      .split('</boltAction>').join('</beamcoreAction>');
    input = normalizedInput;

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
          const closeIndex = input.indexOf(PROJECT_ACTION_TAG_CLOSE, i);

          const currentAction = state.currentAction;

          if (closeIndex !== -1) {
            currentAction.content += input.slice(i, closeIndex);

            let content = currentAction.content.trim();

            if ('type' in currentAction && currentAction.type === 'file') {
              content += '\n';
            }

            currentAction.content = content;

            this._options.callbacks?.onActionClose?.({
              projectId: currentProject.id,
              messageId,

              /**
               * We decrement the id because it's been incremented already
               * when `onActionOpen` was emitted to make sure the ids are
               * the same.
               */
              actionId: String(state.actionId - 1),

              action: currentAction as BeamCoreAction,
            });

            state.insideAction = false;
            state.currentAction = { content: '' };

            i = closeIndex + PROJECT_ACTION_TAG_CLOSE.length;
          } else {
            break;
          }
        } else {
          const actionOpenIndex = input.indexOf(PROJECT_ACTION_TAG_OPEN, i);
          const artifactCloseIndex = input.indexOf(PROJECT_TAG_CLOSE, i);

          if (actionOpenIndex !== -1 && (artifactCloseIndex === -1 || actionOpenIndex < artifactCloseIndex)) {
            const actionEndIndex = input.indexOf('>', actionOpenIndex);

            if (actionEndIndex !== -1) {
              state.insideAction = true;

              state.currentAction = this.#parseActionTag(input, actionOpenIndex, actionEndIndex);

              this._options.callbacks?.onActionOpen?.({
                projectId: currentProject.id,
                messageId,
                actionId: String(state.actionId++),
                action: state.currentAction as BeamCoreAction,
              });

              i = actionEndIndex + 1;
            } else {
              break;
            }
          } else if (artifactCloseIndex !== -1) {
            this._options.callbacks?.onProjectClose?.({ messageId, ...currentProject });

            state.insideProject = false;
            state.currentProject = undefined;

            i = artifactCloseIndex + PROJECT_TAG_CLOSE.length;
          } else {
            break;
          }
        }
      } else if (input[i] === '<' && input[i + 1] !== '/') {
        let j = i;
        let potentialTag = '';

        while (j < input.length && potentialTag.length < PROJECT_TAG_OPEN.length) {
          potentialTag += input[j];

          if (potentialTag === PROJECT_TAG_OPEN) {
            const nextChar = input[j + 1];

            if (nextChar && nextChar !== '>' && nextChar !== ' ') {
              output += input.slice(i, j + 1);
              i = j + 1;
              break;
            }

            const openTagEnd = input.indexOf('>', j);

            if (openTagEnd !== -1) {
              const artifactTag = input.slice(i, openTagEnd + 1);

              const artifactTitle = this.#extractAttribute(artifactTag, 'title') as string;
              const projectId = this.#extractAttribute(artifactTag, 'id') as string;

              if (!artifactTitle) {
                logger.warn('Project title missing');
              }

              if (!projectId) {
                logger.warn('Project id missing');
              }

              state.insideProject = true;

              const currentProject = {
                id: projectId,
                title: artifactTitle,
              } satisfies BeamCoreProjectData;

              state.currentProject = currentProject;

              this._options.callbacks?.onProjectOpen?.({ messageId, ...currentProject });

              const artifactFactory = this._options.projectElement ?? createProjectElement;

              output += artifactFactory({ messageId });

              i = openTagEnd + 1;
            } else {
              earlyBreak = true;
            }

            break;
          } else if (!PROJECT_TAG_OPEN.startsWith(potentialTag)) {
            output += input.slice(i, j + 1);
            i = j + 1;
            break;
          }

          j++;
        }

        if (j === input.length && PROJECT_TAG_OPEN.startsWith(potentialTag)) {
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
