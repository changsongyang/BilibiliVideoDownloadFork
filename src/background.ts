'use strict'

import path from 'path'
import { app, protocol, BrowserWindow, ipcMain, shell, dialog, Menu, globalShortcut } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import { installExtension, VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import fs from 'fs-extra'
import { settingData } from './assets/data/default'
import { TaskData, SettingData, MenuType } from './type'
import downloadVideo from './core/download'
import store from './core/mainStore'
import { STATUS } from './assets/data/status'
import pLimit from 'p-limit'

const got = require('got')
const log = require('electron-log')

const limit = pLimit(10)
const isDevelopment = process.env.NODE_ENV !== 'production'
let win: BrowserWindow

// 设置软件系统菜单
const template: any = [
  {
    // app.name Electron会优先使用 package.json 中的productName 其次再使用name
    label: app.name,
    submenu: [
      { label: '关于', role: 'about' },
      { label: '缩小', role: 'minimize' },
      { label: '退出', role: 'quit' }
    ]
  },
  {
    label: '操作',
    submenu: [
      { label: '全选', role: 'selectAll' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' }
    ]
  }
]
const appMenu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(appMenu)

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

// 打开浏览器
ipcMain.on('open-browser', (event, url) => {
  shell.openExternal(url)
})

// 打开本地文件
ipcMain.on('open-path', (event, path) => {
  shell.openPath(path)
})

// 打开选择文件夹dialog
ipcMain.handle('open-dir-dialog', () => {
  const filePaths = dialog.showOpenDialogSync({
    title: '选择下载地址',
    defaultPath: app.getPath('downloads'),
    properties: ['openDirectory']
  })
  if (filePaths) {
    return Promise.resolve(filePaths[0])
  } else {
    return Promise.reject(new Error('not select'))
  }
})

// 打开文件夹
ipcMain.on('open-dir', (event, list) => {
  if (list.length <= 0) return
  const taskList = store.get('taskList')
  const fileDirs: string[] = []
  list.forEach((id: string) => {
    const task = taskList[id]
    if (task && task.fileDir) fileDirs.push(task.fileDir)
  })
  fileDirs.forEach(dir => {
    shell.openPath(dir)
  })
})

// 发送http请求
ipcMain.handle('got', (event, url, option) => {
  return new Promise((resolve, reject) => {
    got(url, option)
      .then((res: any) => {
        return resolve({ body: res.body, redirectUrls: res.redirectUrls, headers: res.headers })
      })
      .catch((error: any) => {
        log.error(`http error: ${error.message}`)
        return reject(error.message)
      })
  })
})

// 发送http请求，得到buffer
ipcMain.handle('got-buffer', (event, url, option) => {
  return new Promise((resolve, reject) => {
    got(url, option)
      .buffer()
      .then((res: any) => {
        return resolve(res)
      })
      .catch((error: any) => {
        log.error(`http error: ${error.message}`)
        return reject(error.message)
      })
  })
})

// electron-store 操作
ipcMain.handle('get-store', (event, path) => {
  return Promise.resolve(store.get(path))
})

ipcMain.on('set-store', (event, path, data) => {
  // console.log('[main-set-store]: ', path, data)
  store.set(path, data)
})

ipcMain.on('set-task-list-store', (event, list = []) => {
  // console.log('[main-set-task-list-store]: ', list)
  const taskList = store.get('taskList')
  if (Array.isArray(list)) {
    list.forEach((task) => {
      // 频繁触发store.set会卡顿
      // const path = `taskList.${task.id}`
      // store.set(path, task)
      taskList[task.id] = task
    })
    store.set('taskList', taskList)
  }
})

ipcMain.on('delete-store', (event, path) => {
  store.delete(path)
})

ipcMain.on('delete-task-list-store', (event, idList = []) => {
  const taskList = store.get('taskList')
  if (Array.isArray(idList)) {
    idList.forEach(id => {
      delete taskList[id]
    })
    store.set('taskList', taskList)
    // 频繁触发store.delete 会卡顿
    // const updateTaskList = taskList.filter(task => !(idList.includes(task.id)))
    // idList.forEach((id) => {
    //   const path = `taskList.${id}`
    //   store.delete(path)
    // })
  }
})

ipcMain.on('show-context-menu', (event, type: MenuType) => {
  const menuMap = {
    download: [
      {
        label: '删除任务',
        type: 'normal',
        click: () => event.reply('show-context-menu-reply', 'delete')
      },
      {
        label: '重新下载',
        type: 'normal',
        click: () => event.reply('show-context-menu-reply', 'reload')
      },
      {
        label: '打开文件夹',
        type: 'normal',
        click: () => event.reply('show-context-menu-reply', 'open')
      },
      {
        label: '全选',
        type: 'normal',
        click: () => event.reply('show-context-menu-reply', 'selectAll')
      },
      {
        label: '播放视频',
        type: 'normal',
        click: () => event.reply('show-context-menu-reply', 'play')
      }
    ],
    home: [
      { label: '全选', role: 'selectAll' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' }
    ]
  }
  const template: any = menuMap[type]
  const contextMenu = Menu.buildFromTemplate(template)
  contextMenu.popup({ window: win })
})

// 打开删除任务dialog
ipcMain.handle('open-delete-video-dialog', (event, taskCount) => {
  return new Promise((resolve, reject) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: '提示',
      message: `当前选中${taskCount}个任务，你确定要删除吗？`,
      checkboxLabel: '同时删除文件',
      buttons: ['取消', '删除']
    })
      .then(res => {
        return resolve(res)
      })
      .catch(error => {
        return reject(error)
      })
  })
})

// 删除任务文件
ipcMain.handle('delete-videos', async (event, filePaths) => {
  // const delelteList: Promise<void>[] = []
  // for (const key in filePaths) {
  //   delelteList.push(fs.remove(filePaths[key]))
  // }
  // return Promise.all(delelteList) // Promise.resolve('success')
  filePaths.map((fp: string) => limit(() => fs.remove(fp)))
  const tasks = filePaths.map((fp: string) => limit(() => fs.remove(fp)))
  await Promise.all(tasks)
  return 'done'
})

// 下载任务
ipcMain.on('download-video', (event, task: TaskData) => {
  const setting: SettingData = store.get('setting')
  downloadVideo(task, event, setting)
})

ipcMain.on('download-video-list', (event, taskList: TaskData[]) => {
  const setting: SettingData = store.get('setting')
  taskList.forEach((task) => {
    downloadVideo(task, event, setting)
  })
})

// 获取视频大小
ipcMain.handle('get-video-size', (event, id: string) => {
  const task = store.get(`taskList.${id}`)
  if (task && task.filePathList) {
    try {
      // const stat = fs.statSync(task.filePathList[0])
      // return Promise.resolve(stat.size)
      return fs.stat(task.filePathList[0]).then((stat) => stat.size)
    } catch (error: any) {
      log.error(`get-video-size error: ${error.message}`)
    }
    try {
      const stat1 = fs.statSync(task.filePathList[2])
      const stat2 = fs.statSync(task.filePathList[3])
      return Promise.resolve(stat1.size + stat2.size)
    } catch (error) {
      return Promise.resolve(0)
    }
  }
})

ipcMain.handle('check-download-path-exist', () => {
  const setting: SettingData = store.get('setting')
  return fs.existsSync(setting.downloadPath) && fs.statSync(setting.downloadPath).isDirectory()
})

// 关闭app
ipcMain.on('close-app', () => {
  handleCloseApp()
})

// 最小化app
ipcMain.on('minimize-app', () => {
  if (!win.isMinimized()) win.minimize()
})

// 打开删除任务dialog
ipcMain.handle('open-reload-video-dialog', (event, taskCount) => {
  return new Promise((resolve, reject) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: '提示',
      message: `当前选中${taskCount}个任务，你确定要重新下载吗？`,
      buttons: ['取消', '下载']
    })
      .then(res => {
        return resolve(res)
      })
      .catch(error => {
        return reject(error)
      })
  })
})

// 保存弹幕文件
ipcMain.on('save-danmuku-file', (event, content, path) => {
  fs.writeFile(path, content, { encoding: 'utf8' })
})

async function createWindow () {
  // Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    titleBarStyle: 'hidden',
    title: app.name,
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: (process.env.ELECTRON_NODE_INTEGRATION as unknown) as boolean,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string)
    if (!process.env.IS_TEST) {
      setTimeout(() => {
        win.webContents.openDevTools({ mode: 'detach' })
      }, 100)
    }
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    win.loadURL('app://./index.html')
  }
}

function initStore () {
  const setting = store.get('setting')
  const taskList = store.get('taskList')
  if (!setting) {
    store.set('setting', {
      ...settingData,
      downloadPath: app.getPath('downloads'),
      defaultDownladPath: app.getPath('downloads')
    })
  } else {
    store.set('setting', {
      ...settingData,
      ...store.get('setting'),
      defaultDownladPath: app.getPath('downloads')
    })
  }
  if (!taskList) {
    store.set('taskList', {})
  }
  // 存储store
  win.webContents.on('did-finish-load', () => {
    // 开启应用时如果有进行中的任务都重置为失败状态
    // 检查当前是否有下载中任务
    const taskList = store.get('taskList')
    for (const key in taskList) {
      const task = taskList[key]
      if (task.status !== STATUS.COMPLETED && task.status !== STATUS.FAIL) {
        task.status = STATUS.FAIL
      }
    }
    store.set('taskList', taskList)
    win.webContents.send('init-store', {
      setting: store.get('setting'),
      taskList
    })
  })
}

function getDownloadingTaskCount () {
  const taskList = store.get('taskList')
  let count = 0
  for (const key in taskList) {
    const task = taskList[key]
    if (task.status !== STATUS.COMPLETED && task.status !== STATUS.FAIL) {
      count += 1
      // task.progress = 100
    }
  }
  return count
}
function setDownloadingTaskFail () {
  const taskList = store.get('taskList')
  for (const key in taskList) {
    const task = taskList[key]
    if (task.status !== STATUS.COMPLETED && task.status !== STATUS.FAIL) {
      console.log('FAIL', JSON.stringify(task, null, 2))
      task.status = STATUS.FAIL
      // task.progress = 100
    }
  }
  return taskList
}

function handleCloseApp () {
  const count = getDownloadingTaskCount()
  dialog.showMessageBox(win, {
    type: 'info',
    title: '提示',
    message: count ? `当前有${count}个任务正在下载中，关闭软件会导致任务下载失败，是否继续关闭软件？` : '是否关闭应用程序？',
    buttons: ['取消', '关闭']
  })
    .then(res => {
      if (res.response === 1) {
        if (count) store.set('taskList', setDownloadingTaskFail())
        win.destroy()
      }
    })
    .catch(error => {
      console.log(error)
    })
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS_DEVTOOLS)
        .then((ext) => console.log(`Added Extension:  ${ext.name}`))
        .catch((err) => console.log('An error occurred: ', err))
    } catch (e: any) {
      console.error('Vue Devtools failed to install:', e.toString())
    }
  }
  // 创建渲染进程
  createWindow()
  // 初始化store
  initStore()
  // 监听win close
  win.on('close', event => {
    console.log('on win close')
    event.preventDefault()
    handleCloseApp()
  })
  // 添加快捷键
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    const focusWin = BrowserWindow.getFocusedWindow()
    if (focusWin && focusWin.webContents.isDevToolsOpened()) {
      focusWin.webContents.closeDevTools()
    } else if (focusWin && !focusWin.webContents.isDevToolsOpened()) {
      focusWin.webContents.openDevTools({ mode: 'detach' })
    }
  })
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
