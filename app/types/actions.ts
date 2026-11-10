export type ActionType = 'file' | 'shell';

export interface BaseAction {
  content: string;
}

export interface FileAction extends BaseAction {
  type: 'file';
  filePath: string;
}

export interface ShellAction extends BaseAction {
  type: 'shell';
}

export type BeamCoreAction = FileAction | ShellAction;
export type BeamCoreActionData = BeamCoreAction | BaseAction;

/** @deprecated Use BeamCoreAction for new code. */
export type BoltAction = BeamCoreAction;

/** @deprecated Use BeamCoreActionData for new code. */
export type BoltActionData = BeamCoreActionData;
