import { ipcMain, desktopCapturer } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getProjectRoot } from './app';


ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen', 'window'],
      fetchWindowIcons: false
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
    }));
  } catch (error) {
    console.error('Error getting desktop sources:', error);
    return [];
  }
});


ipcMain.handle('get-recordings-dir', () => {
  const projectRoot = getProjectRoot();
  const recordingsDir = path.join(projectRoot, 'recordings');
  
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }
  
  return recordingsDir;

});

// pretty similar logic to "save-transcription" handler, could create function
// if another handler does the same logic 
ipcMain.handle('save-recording', async (_event, data: { buffer: ArrayBuffer; filename: string }) => {
  try {
    const projectRoot = getProjectRoot();
    const recordingsDir = path.join(projectRoot, 'recordings');
    
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    
    const filePath = path.join(recordingsDir, data.filename);
    const buffer = Buffer.from(data.buffer);
    fs.writeFileSync(filePath, buffer);
    
    console.log(`Recording saved: ${filePath}`);
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving recording:', error);
    return { success: false, error: String(error) };
  }
});
