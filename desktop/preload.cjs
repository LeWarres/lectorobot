const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('reader', {
  library: (id = 'all') => ipcRenderer.invoke('library', id),
  add: id => ipcRenderer.invoke('add', id),
  collections: () => ipcRenderer.invoke('collections'),
  createCollection: name => ipcRenderer.invoke('collection-create', name),
  members: id => ipcRenderer.invoke('collection-members', id),
  setMembership: (collection, book, checked) => ipcRenderer.invoke('collection-membership', collection, book, checked),
  displays: () => ipcRenderer.invoke('displays'),
  remove: id => ipcRenderer.invoke('remove', id),
  open: id => ipcRenderer.invoke('open', id),
  cover: id => ipcRenderer.invoke('cover', id),
  pdfCover: id => ipcRenderer.invoke('pdf-cover', id),
  page: (id, page, remember = true, allowPrompt = true) => ipcRenderer.invoke('page', id, page, remember, allowPrompt),
  progress: (id, page) => ipcRenderer.invoke('progress', id, page),
  wallpaper: (display, collection) => ipcRenderer.invoke('wallpaper', display, collection),
  removeWallpaper: display => ipcRenderer.invoke('wallpaper-remove', display),
  wallpaperActive: display => ipcRenderer.invoke('wallpaper-active', display),
  switchWallpaperCollection: collection => ipcRenderer.invoke('wallpaper-switch-collection', collection),
  onLibraryChanged: callback => ipcRenderer.on('library-changed', () => callback()),
  onDisplaysChanged: callback => ipcRenderer.on('displays-changed', () => callback()),
  onWallpaperChanged: callback => ipcRenderer.on('wallpaper-changed', () => callback())
})
