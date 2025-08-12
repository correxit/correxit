import { Button } from '@jupyter/react-components';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { FileDialog } from '@jupyterlab/filebrowser';
import { ServiceManager } from '@jupyterlab/services';
import {
  checkIcon,
  folderIcon,
  LabIcon,
  ReactWidget,
  ToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { ISignal } from '@lumino/signaling';
import React, { useEffect, useState } from 'react';

import { IMultiCorrectModel, IWorkbookModel } from './types';
import { MultiCorrectModel } from './model';
import { Rubric } from '../correxit/rubric';

const PATH_COMPONENT_CLASS = 'correxit-multicorrect-path';
const WORKBOOK_DETAILS_CLASS = 'correxit-multicorrect-wb-details';
const WORKBOOK_SCORE_CLASS = 'correxit-multicorrect-wb-score';
const KERNEL_ICON_CLASS = 'correxit-multicorrect-kernel-icon';
const WORKBOOK_ERROR_CLASS = 'correxit-multicorrect-wb-error';

/**
 * The multi correct widget.
 */
export class MultiCorrect extends ReactWidget {
  constructor(options: MultiCorrect.IOptions) {
    super();
    this._docManager = options.docManager;
    const path = options.initialPath;
    const serviceManager = options.serviceManager;
    this._model =
      options.model ?? new MultiCorrectModel({ serviceManager, path });
  }

  /**
   * The model path.
   */
  get path(): string {
    return this._model.path;
  }

  /**
   * A signal emitting when the model path changed.
   */
  get pathChanged(): ISignal<IMultiCorrectModel, string> {
    return this._model.pathChanged;
  }

  protected render() {
    return (
      <div>
        <PathComponent docManager={this._docManager} model={this._model} />
        <WorkbookList model={this._model} />
      </div>
    );
  }

  private _docManager: IDocumentManager;
  private _model: IMultiCorrectModel;
}

export namespace MultiCorrect {
  /**
   * The construction options of the multi correct widget.
   */
  export interface IOptions {
    /**
     * The service manager.
     */
    serviceManager: ServiceManager.IManager;
    /**
     * The document manager.
     */
    docManager: IDocumentManager;
    /**
     * The initial path of the widget.
     */
    initialPath?: string;
    /**
     * An optional model for the widget.
     */
    model?: IMultiCorrectModel;
  }
}

/**
 * The path component.
 */
const PathComponent: React.FC<{
  docManager: IDocumentManager;
  model: IMultiCorrectModel;
}> = ({ docManager, model }) => {
  const [path, setPath] = useState<string>(`/${model.path}`);

  useEffect(() => {
    const updatePath = (_: IMultiCorrectModel, value: string) => {
      setPath(value);
    };

    model.pathChanged.connect(updatePath);

    return () => {
      model.pathChanged.disconnect(updatePath);
    };
  }, [model]);

  const selectDirectory = async () => {
    try {
      const directory = await FileDialog.getExistingDirectory({
        title: 'Select a directory',
        manager: docManager
      });
      if (directory.value) {
        model.setPath(directory.value[0].path);
      }
    } catch (e) {
      console.warn('Error selecting directory', e);
    }
  };

  const updatePassphrase = (event: React.ChangeEvent<HTMLInputElement>) => {
    model.setPassphrase(event.target.value);
  };

  return (
    <div className={PATH_COMPONENT_CLASS}>
      <Button onClick={selectDirectory}>
        <LabIcon.resolveReact
          icon={folderIcon}
          iconClass={'jp-Icon'}
          tag={null}
        />
      </Button>
      <span>{path}</span>
      <label>
        Passphrase
        <input type={'password'} onChange={updatePassphrase} />
      </label>
    </div>
  );
};

/**
 * The workbook list component.
 */
const WorkbookList: React.FC<{
  model: IMultiCorrectModel;
}> = ({ model }) => {
  const [wbModels, setWbModels] = useState<IWorkbookModel[]>([]);
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    function updateWorkbooks(_: IMultiCorrectModel, value: IWorkbookModel[]) {
      setWbModels([...value]);
      setEnabled(Object.keys(value).length > 0);
    }
    model.workbooksChanged.connect(updateWorkbooks);
    model.initWorkbooks();

    return () => {
      model.workbooksChanged.disconnect(updateWorkbooks);
    };
  }, [model]);

  return (
    <div>
      <ToolbarButtonComponent
        onClick={model.correct}
        tooltip={'Correct all workbooks'}
        icon={checkIcon}
        label={'Correct all'}
        enabled={enabled}
      />
      {enabled ? (
        <div>
          {wbModels.map(model => {
            return <WorkbookScore key={model.path} model={model} />;
          })}
        </div>
      ) : (
        <div style={{ padding: '0 1em' }}>No workbook</div>
      )}
    </div>
  );
};

/**
 * the workbook score component.
 */
const WorkbookScore: React.FC<{
  model: IWorkbookModel;
}> = ({ model }) => {
  const [state, setState] = useState<IWorkbookModel.IState>(model.state);

  useEffect(() => {
    const updateState = () => {
      setState({ ...model.state });
    };

    model.stateChanged.connect(updateState);
    updateState();
    return () => {
      model.stateChanged.disconnect(updateState);
    };
  }, [model]);

  return (
    <div className={WORKBOOK_DETAILS_CLASS}>
      <span>{model.path}</span>
      <span className={WORKBOOK_SCORE_CLASS}>
        {state.status !== 'not scheduled' ? (
          <CorrectingIndicator />
        ) : (
          <>
            <span>
              {state.score === Rubric.UNSCORED
                ? 'unscored'
                : `${state.score[0]} of ${state.score[1]}`}
            </span>
            {state.error && (
              <span className={WORKBOOK_ERROR_CLASS}> ({state.error}) </span>
            )}
            {state.kernelSpec && (
              <>
                {state.kernelSpec.resources['logo-svg'] ? (
                  <img
                    src={state.kernelSpec.resources['logo-svg']}
                    className={KERNEL_ICON_CLASS}
                    title={state.kernelSpec.name}
                    alt={`(${state.kernelSpec.name})`}
                  />
                ) : (
                  <span>({state.kernelSpec.name})</span>
                )}
              </>
            )}
          </>
        )}
      </span>
      <ToolbarButtonComponent
        onClick={model.correct}
        tooltip={'Correct workbook'}
        icon={checkIcon}
        label={'Correct'}
        enabled={state.status === 'not scheduled'}
      />
    </div>
  );
};

/**
 * Animated typing indicator component
 */
const CorrectingIndicator = (): JSX.Element => (
  <span className="correxit-correcting-indicator">
    <span className="correxit-correcting-dot"></span>
    <span className="correxit-correcting-dot"></span>
    <span className="correxit-correcting-dot"></span>
  </span>
);
