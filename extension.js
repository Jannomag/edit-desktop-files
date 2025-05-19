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

    enable() {
        this._settings = this.getSettings()
        this._injectionManager = new InjectionManager()
        this._modifiedMenus = []
        this._addedMenuItems = []

        // Call gettext here explicitly so "Edit" can be localized as part of this extension
        let localizedEditStr = gettext('Edit')

        // Extend the AppMenu's 'open' method to add an 'Edit' MenuItem
        // See: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/appMenu.js
        this._injectionManager.overrideMethod(AppMenu.prototype, 'open',
            originalMethod => {
                const metadata = this.metadata;
                const settings = this.getSettings()
                const modifiedMenus = this._modifiedMenus
                const addedMenuItems = this._addedMenuItems
                const openDesktopFile = this.openDesktopFile

                return function (...args) {

                    // Suitably awful name to ensure it doesn't conflict with an existing/future property
                    if (this._editDesktopFilesExtensionMenuItem) {
                        return originalMethod.call(this, ...args)
                    }

                    // Don't display the menu item for windows not backed by a desktop file
                    const appInfo = this._app?.app_info
                    if (!appInfo) {
                        return originalMethod.call(this, ...args)
                    }

                    // Add the 'Edit' MenuItem
                    let editMenuItem = this.addAction(localizedEditStr, () => {
                        openDesktopFile(metadata, settings, appInfo)

                        if(Main.overview.visible) {
                            Main.overview.hide()
                        }
                    })

                    // Move the 'Edit' MenuItem to be after the 'App Details' MenuItem
                    let menuItems = this._getMenuItems()
                    for (let i = 0; i < menuItems.length; i++) {
                        let menuItem = menuItems[i]
                        if (menuItem.label) {
                            if (menuItem.label.text == _('App Details')) {
                                this.moveMenuItem(editMenuItem, i+1)
                                break
                            }
                        }
                    }

                    // Keep track of menus that have been affected so they can be cleaned up later
                    this._editDesktopFilesExtensionMenuItem = editMenuItem
                    modifiedMenus.push(this)
                    addedMenuItems.push(editMenuItem)

                    return originalMethod.call(this, ...args)
                }
            }
        )
    }

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
        let file = Gio.File.new_for_path(appInfo.filename)
        let uri = file.get_uri()
        Gio.AppInfo.launch_default_for_uri_async(uri, null, null, () => {})
    }

    disable() {
        this._settings = null
        this._injectionManager.clear()
        this._injectionManager = null
        this.removeAllMenuItems()
        this._addedMenuItems = null
        this._modifiedMenus = null
    }

    removeAllMenuItems() {
        // Delete the added properties
        for (let menu of this._modifiedMenus) {
            delete menu._editDesktopFilesExtensionMenuItem
        }
        
        // Delete all added MenuItems
        for (let menuItem of this._addedMenuItems) {
            menuItem.destroy()
        }

        this._addedMenuItems = []
        this._modifiedMenus = []
    }
}