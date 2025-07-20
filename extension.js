/*
 * Edit Desktop Files for GNOME Shell 45+
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import GLib from 'gi://GLib'
import Gio from 'gi://Gio';
import {Extension, InjectionManager, gettext} from 'resource:///org/gnome/shell/extensions/extension.js'
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

/*
* The Edit Desktop Files extension provides users with an "Edit" button on the pop-up menu
* that appears when right-clicking an app icon in the app grid or dash.
* When clicked, the backing desktop file is opened in an editor.
*
* This is done by injecting a function to run prior to the gnome-shell AppMenu's 'open' method.
* The function inserts a new "Edit" MenuItem that, when clicked, either opens the backing desktop
* file with the system's default app for desktop entries or a custom command supplied by the user.
*/
export default class EditDesktopFilesExtension extends Extension {

    // TODO: Update translations to reflect the new menu item names

    enable() {
        this._settings = this.getSettings()
        this._injectionManager = new InjectionManager()
        this._modifiedMenus = []
        this._addedEditMenuItems = []
        this._addedOpenLocationMenuItems = []

        // Call gettext here explicitly so the MenuItems can be localized as part of this extension
        let localizedEditStr = gettext('Edit Entry')
        let localizedOpenLocationStr = gettext('Open Entry Location')

        // List for changes to the 'hide' settings
        this._settings.connect('changed::hide-edit-menu-item', (settings, key) => {
            if (settings.get_boolean(key)) {
                this.removeEditMenuItems()
            }
        });
        this._settings.connect('changed::hide-open-entry-location-menu-item', (settings, key) => {
            if (settings.get_boolean(key)) {
                this.removeOpenLocationMenuItems()
            }
        });

        // Extend the AppMenu's 'open' method to add an 'Edit' MenuItem
        // See: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/appMenu.js
        this._injectionManager.overrideMethod(AppMenu.prototype, 'open',
            originalMethod => {
                const metadata = this.metadata
                const settings = this._settings
                const modifiedMenus = this._modifiedMenus
                const addedEditMenuItems = this._addedEditMenuItems
                const addedOpenLocationMenuItems = this._addedOpenLocationMenuItems

                // Helper functions
                const openDesktopFile = this.openDesktopFile
                const openDesktopFileLocation = this.openDesktopFileLocation
                const hideOverview = this.hideOverview
                const moveMenuItemAfter = this.moveMenuItemAfter

                return function (...args) {

                    // Don't display the menu item for windows not backed by a desktop file
                    const appInfo = this._app?.app_info
                    if (!appInfo) {
                        return originalMethod.call(this, ...args)
                    }

                    // Bind the helper function to the `this` context of the AppMenu
                    const boundMoveMenuItemAfter = moveMenuItemAfter.bind(this)

                    // `Edit Desktop Entry` MenuItem
                    if (!settings.get_boolean("hide-edit-menu-item") && !this._editDesktopFilesExtensionEditMenuItem) {
                        let editMenuItem = this.addAction(localizedEditStr, () => {
                            openDesktopFile(metadata, settings, appInfo)
                            hideOverview()
                        })

                        // Move the 'Edit' MenuItem to be after the 'App Details' MenuItem
                        boundMoveMenuItemAfter(editMenuItem, _('App Details'))

                        this._editDesktopFilesExtensionEditMenuItem = editMenuItem
                        addedEditMenuItems.push(editMenuItem)
                    }

                    // `Open Desktop Entry Location` MenuItem
                    if (!settings.get_boolean("hide-open-entry-location-menu-item") && !this._editDesktopFilesExtensionOpenLocationMenuItem) {
                        let openLocationMenuItem = this.addAction(localizedOpenLocationStr, () => {
                            openDesktopFileLocation(appInfo)
                            hideOverview()
                        })

                        // Move the 'Open Entry Location' MenuItem to be after the 'Edit Entry' MenuItem if it exists
                        let success = boundMoveMenuItemAfter(openLocationMenuItem, localizedEditStr)
                        if (!success) {
                            success = boundMoveMenuItemAfter(openLocationMenuItem, _('App Details'))
                        }

                        this._editDesktopFilesExtensionOpenLocationMenuItem = openLocationMenuItem
                        addedOpenLocationMenuItems.push(openLocationMenuItem)
                    }

                    // Keep track of menus that have been affected so they can be cleaned up later
                    if (!modifiedMenus.includes(this)) {
                        modifiedMenus.push(this)
                    }

                    return originalMethod.call(this, ...args)
                }
            }
        )
    }

    /**
     * Hides the overview if it is currently visible
     */
    hideOverview() {
        if(Main.overview.visible) {
            Main.overview.hide()
        }
    }

    /**
     * Move the MenuItem to be after the MenuItem with the given afterLabel.
     * If no such MenuItem exists, the MenuItem will be added after the
     * 'App Details' MenuItem.
     * @param {Object} menuItem - The MenuItem to be moved
     * @param {string} afterLabel - The label of the MenuItem after which the MenuItem should be moved
     * @returns {boolean} - Returns true if the MenuItem was moved, false if no such MenuItem exists with the given label
     */
    moveMenuItemAfter(menuItemToMove, afterLabel) {
        let menuItems = this._getMenuItems()
        for (let i = 0; i < menuItems.length; i++) {
            let menuItem = menuItems[i]
            if (menuItem.label) {
                if (menuItem.label.text == afterLabel) {
                    this.moveMenuItem(menuItemToMove, i+1)
                    return true
                }
            }
        }

        return false
    }

    /**
     * Open the desktop entry file in the default application or a custom command if the user has set one.
     * @param {Object} metadata - The metadata of the extension
     * @param {Gio.Settings} settings - The settings of the extension
     * @param {Gio.AppInfo} appInfo - The AppInfo of the desktop entry to be edited
     * @returns {void}
     */
    openDesktopFile(metadata, settings, appInfo) {
        // If the user has set a custom command, use that instead of the default app
        if (settings.get_boolean("use-custom-edit-command")) {
            let customEditCommand = settings.get_string("custom-edit-command")
            if (customEditCommand.indexOf('%U') != -1) {
                let editCommand = customEditCommand.replaceAll('%U', `'${appInfo.filename}'`)
                GLib.spawn_command_line_async(editCommand)
                return
            }

            console.warn(`${metadata.name}: Custom edit command is missing '%U', falling back to default application`)
        }
        
        // If the user has not selected a custom command, or the command is invalid, use the default application
        let uri = Gio.File.new_for_path(appInfo.filename).get_uri()
        Gio.AppInfo.launch_default_for_uri_async(uri, null, null, () => {})
    }

    /**
     * Open the location of the desktop entry file in the default application (usually a file manager).
     * If the file manager is known and supports selecting files, it will select the file.
     * @param {Gio.AppInfo} appInfo - The AppInfo of the desktop entry whose location should be opened
     */
    openDesktopFileLocation(appInfo) {
        let file = Gio.File.new_for_path(appInfo.filename)
        let filepath = file.get_path()

        const fileManagerCommands = {
            'nautilus': (path) => `nautilus --select '${path}'`,
            // Add more file managers and their commands here
        }

        // Get the default app for file:// URIs (usually nautilus or another file manager)
        let defaultDirAppInfo = Gio.AppInfo.get_default_for_type('inode/directory', false)
        let executable = defaultDirAppInfo ? defaultDirAppInfo.get_executable() : null

        if (executable && fileManagerCommands[executable]) {
            // Run the file manager with its select command
            let selectCmd = fileManagerCommands[executable](filepath)
            GLib.spawn_command_line_async(selectCmd)
        } else {
            // Fallback: open parent folder with default method without selecting the file
            let parent = file.get_parent()
            Gio.AppInfo.launch_default_for_uri_async(parent.get_uri(), null, null, () => {})
        }
    }

    disable() {
        this._settings = null
        this._injectionManager.clear()
        this._injectionManager = null
        this.removeEditMenuItems()
        this.removeOpenLocationMenuItems()
        this._addedEditMenuItems = null
        this._addedOpenLocationMenuItems = null
        this._modifiedMenus = null
    }

    /**
     * Remove the `Edit` MenuItems from the menus
     * @returns {void}
     */
    removeEditMenuItems() {
        for (let menu of this._modifiedMenus) {
            delete menu._editDesktopFilesExtensionEditMenuItem
        }
        
        for (let menuItem of this._addedEditMenuItems) {
            menuItem.destroy()
        }

        this._addedEditMenuItems.length = 0
    }

    /**
     * Remove the `Show Entry Location` MenuItems from the menus
     * @returns {void}
     */
    removeOpenLocationMenuItems() {
        for (let menu of this._modifiedMenus) {
            delete menu._editDesktopFilesExtensionOpenLocationMenuItem
        }
    
        for (let menuItem of this._addedOpenLocationMenuItems) {
            menuItem.destroy()
        }

        this._addedOpenLocationMenuItems.length = 0
    }
}