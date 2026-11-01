/* 预加载只暴露一个通道开关：网页解析出内测/正式通道后调用 setChannel，
   壳把它落到 userData 下的 beta-channel.txt，不接受其它能力。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jddDesktop', {
  setChannel: (ch) => ipcRenderer.send('jdd:set-beta-channel', ch),
  isDesktop: true
});
