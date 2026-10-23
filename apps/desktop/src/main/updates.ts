import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'

let pending = false

export async function checkForUpdates() {
  if (pending) return
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      message: '开发版本不提供更新',
      detail: '正式安装版本会从随包配置的 HTTPS 更新源检查更新。',
    })
    return
  }
  pending = true
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  // 诊断对象可能含更新源响应与本地路径，显示边界只提供固定本地化反馈。
  autoUpdater.logger = null
  const onError = () => {}
  autoUpdater.on('error', onError)
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) {
      await dialog.showMessageBox({ message: '已是最新版本' })
      return
    }
    const download = await dialog.showMessageBox({
      message: '发现新版本',
      detail: '下载完成后，可选择重启安装。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (download.response !== 0) return
    await autoUpdater.downloadUpdate()
    const install = await dialog.showMessageBox({
      message: '更新已准备好',
      detail: '重启将停止正在生成的回复。请确认工作已保存。',
      buttons: ['重启并安装', '稍后'],
      defaultId: 1,
      cancelId: 1,
    })
    if (install.response === 0) autoUpdater.quitAndInstall()
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      message: '检查或安装更新失败',
      detail: '请稍后重试，或从官方渠道下载最新安装包。',
    })
  } finally {
    autoUpdater.removeListener('error', onError)
    pending = false
  }
}
