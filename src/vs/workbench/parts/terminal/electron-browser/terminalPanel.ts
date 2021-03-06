/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as dom from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import * as platform from 'vs/base/common/platform';
import { Action, IAction } from 'vs/base/common/actions';
import { Builder, Dimension } from 'vs/base/browser/builder';
import { IActionItem, Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ITerminalService, ITerminalFont, TERMINAL_PANEL_ID } from 'vs/workbench/parts/terminal/common/terminal';
import { IThemeService, ITheme } from 'vs/platform/theme/common/themeService';
import { TerminalFindWidget } from './terminalFindWidget';
import { editorHoverBackground, editorHoverBorder, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { KillTerminalAction, CreateNewTerminalAction, SwitchTerminalInstanceAction, SwitchTerminalInstanceActionItem, CopyTerminalSelectionAction, TerminalPasteAction, ClearTerminalAction, SelectAllTerminalAction } from 'vs/workbench/parts/terminal/electron-browser/terminalActions';
import { Panel } from 'vs/workbench/browser/panel';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { PANEL_BACKGROUND } from 'vs/workbench/common/theme';
import { TERMINAL_BACKGROUND_COLOR } from 'vs/workbench/parts/terminal/electron-browser/terminalColorRegistry';

export class TerminalPanel extends Panel {

	private _actions: IAction[];
	private _copyContextMenuAction: IAction;
	private _contextMenuActions: IAction[];
	private _cancelContextMenu: boolean = false;
	private _font: ITerminalFont;
	private _fontStyleElement: HTMLElement;
	private _parentDomElement: HTMLElement;
	private _terminalContainer: HTMLElement;
	private _themeStyleElement: HTMLElement;
	private _findWidget: TerminalFindWidget;

	constructor(
		@IConfigurationService private _configurationService: IConfigurationService,
		@IContextMenuService private _contextMenuService: IContextMenuService,
		@IContextViewService private _contextViewService: IContextViewService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@ITerminalService private _terminalService: ITerminalService,
		@IThemeService protected themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService
	) {
		super(TERMINAL_PANEL_ID, telemetryService, themeService);
	}

	public create(parent: Builder): TPromise<any> {
		super.create(parent);
		this._parentDomElement = parent.getHTMLElement();
		dom.addClass(this._parentDomElement, 'integrated-terminal');
		this._themeStyleElement = document.createElement('style');
		this._fontStyleElement = document.createElement('style');

		this._terminalContainer = document.createElement('div');
		dom.addClass(this._terminalContainer, 'terminal-outer-container');

		this._findWidget = this._instantiationService.createInstance(TerminalFindWidget);

		this._parentDomElement.appendChild(this._themeStyleElement);
		this._parentDomElement.appendChild(this._fontStyleElement);
		this._parentDomElement.appendChild(this._terminalContainer);
		this._parentDomElement.appendChild(this._findWidget.getDomNode());

		this._attachEventListeners();

		this._terminalService.setContainers(this.getContainer().getHTMLElement(), this._terminalContainer);

		this._register(this.themeService.onThemeChange(theme => this._updateTheme(theme)));
		this._register(this._configurationService.onDidUpdateConfiguration(() => this._updateFont()));
		this._updateFont();
		this._updateTheme();

		// Force another layout (first is setContainers) since config has changed
		this.layout(new Dimension(this._terminalContainer.offsetWidth, this._terminalContainer.offsetHeight));
		return TPromise.as(void 0);
	}

	public layout(dimension?: Dimension): void {
		if (!dimension) {
			return;
		}
		this._terminalService.terminalInstances.forEach((t) => {
			t.layout(dimension);
		});
	}

	public setVisible(visible: boolean): TPromise<void> {
		if (visible) {
			if (this._terminalService.terminalInstances.length > 0) {
				this._updateFont();
				this._updateTheme();
			} else {
				return super.setVisible(visible).then(() => {
					const instance = this._terminalService.createInstance();
					if (instance) {
						this._updateFont();
						this._updateTheme();
					}
					return TPromise.as(void 0);
				});
			}
		}
		return super.setVisible(visible);
	}

	public getActions(): IAction[] {
		if (!this._actions) {
			this._actions = [
				this._instantiationService.createInstance(SwitchTerminalInstanceAction, SwitchTerminalInstanceAction.ID, SwitchTerminalInstanceAction.LABEL),
				this._instantiationService.createInstance(CreateNewTerminalAction, CreateNewTerminalAction.ID, CreateNewTerminalAction.PANEL_LABEL),
				this._instantiationService.createInstance(KillTerminalAction, KillTerminalAction.ID, KillTerminalAction.PANEL_LABEL)
			];
			this._actions.forEach(a => {
				this._register(a);
			});
		}
		return this._actions;
	}

	private _getContextMenuActions(): IAction[] {
		if (!this._contextMenuActions) {
			this._copyContextMenuAction = this._instantiationService.createInstance(CopyTerminalSelectionAction, CopyTerminalSelectionAction.ID, nls.localize('copy', "Copy"));
			this._contextMenuActions = [
				this._instantiationService.createInstance(CreateNewTerminalAction, CreateNewTerminalAction.ID, nls.localize('createNewTerminal', "New Terminal")),
				new Separator(),
				this._copyContextMenuAction,
				this._instantiationService.createInstance(TerminalPasteAction, TerminalPasteAction.ID, nls.localize('paste', "Paste")),
				this._instantiationService.createInstance(SelectAllTerminalAction, SelectAllTerminalAction.ID, nls.localize('selectAll', "Select All")),
				new Separator(),
				this._instantiationService.createInstance(ClearTerminalAction, ClearTerminalAction.ID, nls.localize('clear', "Clear"))
			];
			this._contextMenuActions.forEach(a => {
				this._register(a);
			});
		}
		const activeInstance = this._terminalService.getActiveInstance();
		this._copyContextMenuAction.enabled = activeInstance && activeInstance.hasSelection();
		return this._contextMenuActions;
	}

	public getActionItem(action: Action): IActionItem {
		if (action.id === SwitchTerminalInstanceAction.ID) {
			return this._instantiationService.createInstance(SwitchTerminalInstanceActionItem, action);
		}

		return super.getActionItem(action);
	}

	public focus(): void {
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance) {
			activeInstance.focus(true);
		}
	}

	public focusFindWidget() {
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance && activeInstance.hasSelection() && activeInstance.selection.indexOf('\n') === -1) {
			this._findWidget.reveal(activeInstance.selection);
		} else {
			this._findWidget.reveal();
		}
	}

	public hideFindWidget() {
		this._findWidget.hide();
	}

	public showNextFindTermFindWidget(): void {
		this._findWidget.showNextFindTerm();
	}

	public showPreviousFindTermFindWidget(): void {
		this._findWidget.showPreviousFindTerm();
	}

	private _attachEventListeners(): void {
		this._register(dom.addDisposableListener(this._parentDomElement, 'mousedown', (event: MouseEvent) => {
			if (this._terminalService.terminalInstances.length === 0) {
				return;
			}

			if (event.which === 2 && platform.isLinux) {
				// Drop selection and focus terminal on Linux to enable middle button paste when click
				// occurs on the selection itself.
				this._terminalService.getActiveInstance().focus();
			} else if (event.which === 3) {
				if (this._terminalService.configHelper.config.rightClickCopyPaste) {
					let terminal = this._terminalService.getActiveInstance();
					if (terminal.hasSelection()) {
						terminal.copySelection();
						terminal.clearSelection();
					} else {
						terminal.paste();
					}
					// Clear selection after all click event bubbling is finished on Mac to prevent
					// right-click selecting a word which is seemed cannot be disabled. There is a
					// flicker when pasting but this appears to give the best experience if the
					// setting is enabled.
					if (platform.isMacintosh) {
						setTimeout(() => {
							terminal.clearSelection();
						}, 0);
					}
					this._cancelContextMenu = true;
				}
			}
		}));
		this._register(dom.addDisposableListener(this._parentDomElement, 'contextmenu', (event: MouseEvent) => {
			if (!this._cancelContextMenu) {
				const standardEvent = new StandardMouseEvent(event);
				let anchor: { x: number, y: number } = { x: standardEvent.posx, y: standardEvent.posy };
				this._contextMenuService.showContextMenu({
					getAnchor: () => anchor,
					getActions: () => TPromise.as(this._getContextMenuActions()),
					getActionsContext: () => this._parentDomElement
				});
			}
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(this._parentDomElement, 'click', (event) => {
			if (event.which === 3) {
				return;
			}

			const instance = this._terminalService.getActiveInstance();
			if (instance) {
				this._terminalService.getActiveInstance().focus();
			}
		}));
		this._register(dom.addDisposableListener(this._parentDomElement, 'keyup', (event: KeyboardEvent) => {
			if (event.keyCode === 27) {
				// Keep terminal open on escape
				event.stopPropagation();
			}
		}));
		this._register(dom.addDisposableListener(this._parentDomElement, dom.EventType.DROP, (e: DragEvent) => {
			if (e.target === this._parentDomElement || dom.isAncestor(e.target as HTMLElement, this._parentDomElement)) {
				if (!e.dataTransfer) {
					return;
				}

				// Check if the file was dragged from the tree explorer
				let uri = e.dataTransfer.getData('URL');
				if (uri) {
					uri = URI.parse(uri).path;
				} else if (e.dataTransfer.files.length > 0) {
					// Check if the file was dragged from the filesystem
					uri = URI.file(e.dataTransfer.files[0].path).fsPath;
				}

				if (!uri) {
					return;
				}

				const terminal = this._terminalService.getActiveInstance();
				terminal.sendText(TerminalPanel.preparePathForTerminal(uri), false);
			}
		}));
	}

	private _updateTheme(theme?: ITheme): void {
		if (!theme) {
			theme = this.themeService.getTheme();
		}

		let css = '';

		const backgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
		this._terminalContainer.style.backgroundColor = backgroundColor ? backgroundColor.toString() : '';

		// Borrow the editor's hover background for now
		let hoverBackground = theme.getColor(editorHoverBackground);
		if (hoverBackground) {
			css += `.monaco-workbench .panel.integrated-terminal .terminal-message-widget { background-color: ${hoverBackground}; }`;
		}
		let hoverBorder = theme.getColor(editorHoverBorder);
		if (hoverBorder) {
			css += `.monaco-workbench .panel.integrated-terminal .terminal-message-widget { border: 1px solid ${hoverBorder}; }`;
		}
		let hoverForeground = theme.getColor(editorForeground);
		if (hoverForeground) {
			css += `.monaco-workbench .panel.integrated-terminal .terminal-message-widget { color: ${hoverForeground}; }`;
		}

		this._themeStyleElement.innerHTML = css;
		this._findWidget.updateTheme(theme);
	}

	private _updateFont(): void {
		if (this._terminalService.terminalInstances.length === 0) {
			return;
		}
		this._font = this._terminalService.configHelper.getFont();
		// TODO: Can we support ligatures? id:119 gh:120
		// dom.toggleClass(this._parentDomElement, 'enable-ligatures', this._terminalService.configHelper.config.fontLigatures);
		// TODO: How to handle Disable bold? id:117 gh:118
		// dom.toggleClass(this._parentDomElement, 'disable-bold', !this._terminalService.configHelper.config.enableBold);
		this.layout(new Dimension(this._parentDomElement.offsetWidth, this._parentDomElement.offsetHeight));
	}

	/**
	 * Adds quotes to a path if it contains whitespaces
	 */
	public static preparePathForTerminal(path: string): string {
		if (platform.isWindows) {
			if (/\s+/.test(path)) {
				return `"${path}"`;
			}
			return path;
		}
		path = path.replace(/(%5C|\\)/g, '\\\\');
		const charsToEscape = [
			' ', '\'', '"', '?', ':', ';', '!', '*', '(', ')', '{', '}', '[', ']'
		];
		for (let i = 0; i < path.length; i++) {
			const indexOfChar = charsToEscape.indexOf(path.charAt(i));
			if (indexOfChar >= 0) {
				path = `${path.substring(0, i)}\\${path.charAt(i)}${path.substring(i + 1)}`;
				i++; // Skip char due to escape char being added
			}
		}
		return path;
	}
}
