const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getReviews: () => ipcRenderer.invoke('reviews:get'),
  saveReview: (review) => ipcRenderer.invoke('reviews:save', review),
  deleteReview: (id) => ipcRenderer.invoke('reviews:delete', id)
});
