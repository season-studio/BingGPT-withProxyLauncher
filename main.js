const {
  app,
  shell,
  nativeTheme,
  dialog,
  ipcMain,
  Menu,
  BrowserWindow,
  clipboard
} = require('electron')
const contextMenu = require('electron-context-menu')
const Store = require('electron-store')
const path = require('path')
const fs = require('fs')
const childProcess = require("child_process");
const net = require("net");

let configFilePath = app.commandLine.getSwitchValue('config');
if (configFilePath) {
    configFilePath = path.resolve(process.cwd(), configFilePath);
} else {
    configFilePath = path.resolve(path.dirname(process.execPath), "config.json");
}
console.log("config file is:", configFilePath);
const configStr = (function () {
    try {
        return fs.readFileSync(configFilePath);
    } catch {
        return "{}";
    }
})();
const configObject = (function () {
    try {
        return JSON.parse(configStr);
    } catch {

    }
})() || {};

async function startProxy() {
    try {
        if (configObject.proxy?.serverApp?.path) {
            let workDir = configObject.proxy.serverApp.workDir || path.dirname(configObject.proxy.serverApp.path);
            childProcess.exec(`"${configObject.proxy.serverApp.path}" ${configObject.proxy.serverApp.args || ""}`, {
                cwd: workDir
            });
            if (configObject.proxy?.checker?.port) {
                const timeout = Number(configObject.proxy.checker.timeout) || 60;
                async function checker() {
                    let ret = false;
                    let waitWin = new BrowserWindow({
                        width: 500, 
                        height: 300, 
                        transparent: false, 
                        frame: false, 
                        alwaysOnTop: true 
                    });
                    waitWin.loadURL('data:text/html;charset=utf-8,<html><body><h1>Waiting for the proxy...</h1></body></html>');
                    for (let i = 0; !ret && (i < timeout); i++) {
                        let socket = net.connect(configObject.proxy.checker.port, configObject.proxy.checker.address || "127.0.0.1", () => {
                            ret = true;
                            socket.destroy();
                        }).on('error', (err) => console.log("proxy no ready..."));
                        if (!ret) {
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }
                    waitWin.close();
                    waitWin = undefined;
                    return ret;
                }
                return await checker();
            }
        }
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

if (require('electron-squirrel-startup')) app.quit();

const configSchema = {
    theme: {
        enum: ['system', 'light', 'dark'],
        default: 'system',
    },
    fontSize: {
        enum: [14, 16, 18, 20],
        default: 14,
    },
    alwaysOnTop: {
        type: 'boolean',
        default: false,
    },
}
const config = new Store({ schema: configSchema, clearInvalidConfig: true })

const createWindow = () => {
    // Get theme settings
    const theme = config.get('theme')
    const isDarkMode =
        theme === 'system'
            ? nativeTheme.shouldUseDarkColors
            : theme === 'dark'
                ? true
                : false
    // Create window
    const mainWindow = new BrowserWindow({
        title: 'BingGPT',
        backgroundColor: isDarkMode ? '#2b2b2b' : '#f3f3f3',
        icon: 'icon.png',
        width: 601,
        height: 800,
        titleBarStyle: 'hidden',
        titleBarOverlay: true,
        titleBarOverlay: {
            color: isDarkMode ? '#3b3b3b' : '#ffffff',
            symbolColor: isDarkMode ? '#f3f3f3' : '#2b2b2b',
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            devTools: false,
            nodeIntegration: true,
        },
    })
    // Get always on top settings
    const alwaysOnTop = config.get('alwaysOnTop')
    mainWindow.setAlwaysOnTop(alwaysOnTop)
    // Get language
    const locale = app.getLocale() || 'en-US'
    // Hide main menu (Windows)
    Menu.setApplicationMenu(null);
    // The url and user-agent
    const bingUrl = `https://edgeservices.bing.com/edgediscover/query?&${isDarkMode ? 'dark' : 'light'
        }schemeovr=1&FORM=SHORUN&udscs=1&udsnav=1&setlang=${locale}&features=udssydinternal&clientscopes=windowheader,coauthor,chat,&udsframed=1`
    const userAgent =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36 Edg/112.0.0.0'
    // Create context menu
    contextMenu({
        window: mainWindow.webContents,
        showServices: true,
        showSelectAll: false,
        append: (defaultActions, parameters, browserWindow) => [
            {
                label: 'Reload',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    mainWindow.reload()
                },
            },
            {
                label: 'Reload the default URL',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    mainWindow.loadURL(bingUrl);
                },
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Export',
                visible: parameters.selectionText.trim().length === 0,
                submenu: [
                    {
                        label: 'Markdown',
                        click() {
                            mainWindow.webContents.send('export', 'md', isDarkMode)
                        },
                    },
                    {
                        label: 'PNG',
                        click() {
                            mainWindow.webContents.send('export', 'png', isDarkMode)
                        },
                    },
                    {
                        label: 'PDF',
                        click() {
                            mainWindow.webContents.send('export', 'pdf', isDarkMode)
                        },
                    },
                ],
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Always on Top',
                type: 'checkbox',
                checked: mainWindow.isAlwaysOnTop() ? true : false,
                visible: parameters.selectionText.trim().length === 0,
                click: () => alwaysOnTopHandler(),
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Appearance',
                visible: parameters.selectionText.trim().length === 0,
                submenu: [
                    {
                        label: 'Theme',
                        submenu: [
                            {
                                label: 'System',
                                type: 'radio',
                                checked: config.get('theme') === 'system',
                                click() {
                                    themeHandler('system')
                                },
                            },
                            {
                                label: 'Light',
                                type: 'radio',
                                checked: config.get('theme') === 'light',
                                click() {
                                    themeHandler('light')
                                },
                            },
                            {
                                label: 'Dark',
                                type: 'radio',
                                checked: config.get('theme') === 'dark',
                                click() {
                                    themeHandler('dark')
                                },
                            },
                        ],
                    },
                    {
                        label: 'Font Size',
                        submenu: [
                            {
                                label: 'Default',
                                type: 'radio',
                                checked: config.get('fontSize') === 14,
                                click() {
                                    fontSizeHandler(14)
                                },
                            },
                            {
                                label: 'Medium',
                                type: 'radio',
                                checked: config.get('fontSize') === 16,
                                click() {
                                    fontSizeHandler(16)
                                },
                            },
                            {
                                label: 'Large',
                                type: 'radio',
                                checked: config.get('fontSize') === 18,
                                click() {
                                    fontSizeHandler(18)
                                },
                            },
                            {
                                label: 'Extra Large',
                                type: 'radio',
                                checked: config.get('fontSize') === 20,
                                click() {
                                    fontSizeHandler(20)
                                },
                            },
                        ],
                    },
                ],
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Reset',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    dialog.showMessageBox({
                        type: 'question',
                        title: 'Reset',
                        message: 'Are you sure to clear the all cache data?',
                        buttons: ['Yes', 'No']
                    }).then((result) => {
                        if (result.response === 0) {
                            const session = mainWindow.webContents.session
                            session
                                .clearStorageData({
                                    storages: ['localstorage', 'cookies'],
                                })
                                .then(() => {
                                    mainWindow.reload()
                                });
                        }
                    });
                    
                },
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Feedback',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    shell.openExternal('https://github.com/dice2o/BingGPT/issues')
                },
            },
            {
                label: 'BingGPT v0.3.2',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    shell.openExternal('https://github.com/dice2o/BingGPT/releases')
                },
            },
            {
                type: 'separator',
                visible: parameters.selectionText.trim().length === 0,
            },
            {
                label: 'Configuation File...',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    shell.openExternal(configFilePath);
                }
            },
            {
                label: 'Show and Copy the current URL',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    let url = mainWindow.webContents.getURL();
                    clipboard.writeText(url);
                    dialog.showMessageBox({
                        type: 'info',
                        title: 'Current URL',
                        message: 'Current URL is',
                        detail: url,
                        buttons: ['OK']
                    });
                }
            },
            {
                label: 'Load a URL from the clipboard',
                visible: parameters.selectionText.trim().length === 0,
                click: () => {
                    let url = clipboard.readText();
                    dialog.showMessageBox({
                        type: 'question',
                        title: 'Load URL',
                        message: 'Load URL is',
                        detail: url,
                        buttons: ['Yes', 'No']
                    }).then((result) => {
                        if (result.response === 0) {
                            mainWindow.loadURL(url)
                        }
                    });
                }
            }
        ],
    })
    // Load Bing
    mainWindow.loadURL(bingUrl);
    console.log(bingUrl);
    // Open links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })
    // Check if user is logged in successfully
    mainWindow.webContents.on('will-redirect', (event, url) => {
        if (
            url.indexOf('https://edgeservices.bing.com/edgesvc/urlredirect') !== -1
        ) {
            event.preventDefault()
            mainWindow.loadURL(bingUrl)
        }
    })
    // Modify Content Security Policy
    mainWindow.webContents.session.webRequest.onHeadersReceived(
        (details, callback) => {
            let responseHeaders = details.responseHeaders
            const CSP = responseHeaders['content-security-policy']
            if (details.url === bingUrl && CSP) {
                responseHeaders['content-security-policy'] = CSP[0]
                    .replace(`require-trusted-types-for 'script'`, '')
                    .replace('report-to csp-endpoint', '')
                callback({
                    cancel: false,
                    responseHeaders,
                })
            } else {
                return callback({ cancel: false })
            }
        }
    )
    // 设置代理
    const proxyRules = configObject.proxy?.rules;
    if (proxyRules) {
        mainWindow.webContents.session.setProxy({
            mode: 'fixed_servers',
            proxyRules
        });
    }
    // Modify headers
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
        (details, callback) => {
            details.requestHeaders['user-agent'] = userAgent
            if (details.url !== bingUrl) {
                details.requestHeaders['x-forwarded-for'] = '1.1.1.1'
            }
            callback({ requestHeaders: details.requestHeaders, cancel: false })
        }
    )
    // Always on top
    const alwaysOnTopHandler = () => {
        config.set('alwaysOnTop', !mainWindow.isAlwaysOnTop())
        mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop())
    }
    // Theme
    const themeHandler = (newTheme) => {
        config.set('theme', newTheme)
        dialog
            .showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['Yes', 'No'],
                message: 'Theme Saved',
                detail: 'Do you want to reload BingGPT now?',
            })
            .then((result) => {
                if (result.response === 0) {
                    mainWindow.close()
                    createWindow()
                }
            })
    }
    // Font size
    const fontSizeHandler = (newSize) => {
        config.set('fontSize', newSize)
        mainWindow.webContents.send('set-font-size', newSize)
    }
    // Shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
        const cmdKey = process.platform === 'darwin' ? input.meta : input.control
        if (cmdKey) {
            switch (input.code) {
                case 'KeyN':
                    mainWindow.webContents.send('new-topic')
                    event.preventDefault()
                    break
                case 'KeyR':
                    mainWindow.reload()
                    event.preventDefault()
                    break
                case 'KeyT':
                    alwaysOnTopHandler()
                    event.preventDefault()
                    break
                case 'KeyI':
                    mainWindow.webContents.send('focus-on-textarea')
                    event.preventDefault()
                    break
                case 'KeyS':
                    mainWindow.webContents.send('stop-responding')
                    event.preventDefault()
                    break
                case 'Equal':
                    if (
                        configSchema.fontSize.enum.indexOf(config.get('fontSize') + 2) !==
                        -1
                    ) {
                        fontSizeHandler(config.get('fontSize') + 2)
                        event.preventDefault()
                    }
                    break
                case 'Minus':
                    if (
                        configSchema.fontSize.enum.indexOf(config.get('fontSize') - 2) !==
                        -1
                    ) {
                        fontSizeHandler(config.get('fontSize') - 2)
                        event.preventDefault()
                    }
                    break
                case 'Comma':
                    mainWindow.webContents.send('switch-tone', 'left')
                    event.preventDefault()
                    break
                case 'Period':
                    mainWindow.webContents.send('switch-tone', 'right')
                    event.preventDefault()
                    break
                default:
                    if (input.code.indexOf('Digit') === 0) {
                        const id = input.code.split('Digit')[1]
                        mainWindow.webContents.send('quick-reply', Number(id))
                        event.preventDefault()
                    }
            }
        }
    })
}

app.whenReady().then(() => {
    // Save to file
    ipcMain.on('export-data', (event, format, dataURL) => {
        if (format) {
            const fileName = `BingGPT-${Math.floor(Date.now() / 1000)}.${format}`
            let filters
            switch (format) {
                case 'md':
                    filters = [{ name: 'Markdown', extensions: ['md'] }]
                    break
                case 'png':
                    filters = [{ name: 'Image', extensions: ['png'] }]
                    break
                case 'pdf':
                    filters = [{ name: 'PDF', extensions: ['pdf'] }]
            }
            dialog
                .showSaveDialog(BrowserWindow.getAllWindows()[0], {
                    title: 'Export',
                    defaultPath: fileName,
                    filters: filters,
                })
                .then((result) => {
                    if (!result.canceled) {
                        const filePath = result.filePath
                        const data = dataURL.replace(/^data:\S+;base64,/, '')
                        fs.writeFile(filePath, data, 'base64', (err) => {
                            if (err) {
                                dialog.showMessageBox({
                                    type: 'info',
                                    message: 'Error',
                                    detail: err,
                                })
                            }
                        })
                    }
                })
        }
    })
    // Get font size settings
    ipcMain.on('get-font-size', () => {
        const fontSize = config.get('fontSize')
        if (fontSize !== 14) {
            setTimeout(() => {
                BrowserWindow.getAllWindows()[0].webContents.send(
                    'set-font-size',
                    fontSize
                )
            }, 1000)
        }
    })
    // Error message
    ipcMain.on('error', (event, detail) => {
        dialog.showMessageBox({
            type: 'info',
            message: 'Error',
            detail: detail,
        })
    })
    startProxy().then(proxyReady => {
        if (proxyReady) {
            createWindow()
            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) createWindow()
            })
        } else {
            dialog.showMessageBoxSync(null, {
                type: "error",
                message: `The proxy is not ready!\r\nPlease check the configuration file.\r\n(${configFilePath})`
            });
            app.quit();
        }
    });
    
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
});
