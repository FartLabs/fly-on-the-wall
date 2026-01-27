interface NoteFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

let currentNoteFilename: string | null = null;

export function showHistoryPage(): void {
  const mainPage = document.getElementById('mainPage');
  const historyPage = document.getElementById('historyPage');
  
  if (mainPage && historyPage) {
    mainPage.classList.add('hidden');
    historyPage.classList.remove('hidden');
    loadHistory();
  }
}

export function showMainPage(): void {
  const mainPage = document.getElementById('mainPage');
  const historyPage = document.getElementById('historyPage');
  
  if (mainPage && historyPage) {
    historyPage.classList.add('hidden');
    mainPage.classList.remove('hidden');
    closeNoteViewer();
  }
}

export async function loadHistory(): Promise<void> {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  
  historyList.innerHTML = '<p class="loading-text">Loading history...</p>';
  
  try {
    const result = await window.electronAPI.listNotes();
    
    if (!result.success || result.files.length === 0) {
      historyList.innerHTML = '<p class="empty-text">No saved notes yet. Record a meeting to get started!</p>';
      return;
    }
    
    historyList.innerHTML = '';
    
    result.files.forEach((file: NoteFile) => {
      const item = createHistoryItem(file);
      historyList.appendChild(item);
    });
  } catch (error) {
    console.error('Error loading history:', error);
    historyList.innerHTML = '<p class="error-text">Failed to load history. Please try again.</p>';
  }
}

function createHistoryItem(file: NoteFile): HTMLElement {
  const item = document.createElement('div');
  item.className = 'history-item';
  
  const type = getFileType(file.name);
  const icon = type === 'transcription' ? '📝' : '📄';
  const typeLabel = type === 'transcription' ? 'Transcription' : 'Summary';
  
  const date = new Date(file.modified);
  const formattedDate = formatDate(date);
  const formattedTime = formatTime(date);
  
  item.innerHTML = `
    <div class="history-item-icon">${icon}</div>
    <div class="history-item-info">
      <div class="history-item-type">${typeLabel}</div>
      <div class="history-item-date">${formattedDate} at ${formattedTime}</div>
    </div>
    <button class="history-item-btn" title="View">👁️</button>
  `;
  
  const viewBtn = item.querySelector('.history-item-btn');
  viewBtn?.addEventListener('click', () => openNote(file.name));
  
  return item;
}

function getFileType(filename: string): 'transcription' | 'summary' {
  if (filename.startsWith('transcription_')) {
    return 'transcription';
  }
  return 'summary';
}

function formatDate(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined 
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

async function openNote(filename: string): Promise<void> {
  try {
    const result = await window.electronAPI.readNote(filename);
    
    if (!result.success) {
      alert('Failed to open note: ' + result.error);
      return;
    }
    
    currentNoteFilename = filename;
    
    const noteViewerCard = document.getElementById('noteViewerCard');
    const noteViewerTitle = document.getElementById('noteViewerTitle');
    const noteContent = document.getElementById('noteContent');
    
    if (!noteViewerCard || !noteViewerTitle || !noteContent) return;
    
    const type = getFileType(filename);
    noteViewerTitle.textContent = type === 'transcription' ? 'Transcription' : 'Summary';
    noteContent.textContent = result.content;
    
    noteViewerCard.classList.remove('hidden');
  } catch (error) {
    console.error('Error opening note:', error);
    alert('Failed to open note');
  }
}

function closeNoteViewer(): void {
  const noteViewerCard = document.getElementById('noteViewerCard');
  if (noteViewerCard) {
    noteViewerCard.classList.add('hidden');
  }
  currentNoteFilename = null;
}

async function copyCurrentNote(): Promise<void> {
  const noteContent = document.getElementById('noteContent');
  if (!noteContent) return;
  
  try {
    await navigator.clipboard.writeText(noteContent.textContent || '');
    
    const copyBtn = document.getElementById('copyNoteBtn');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to copy:', error);
    alert('Failed to copy to clipboard');
  }
}

async function deleteCurrentNote(): Promise<void> {
  if (!currentNoteFilename) return;
  
  const confirmed = confirm('Are you sure you want to delete this note? This cannot be undone.');
  if (!confirmed) return;
  
  try {
    const result = await window.electronAPI.deleteNote(currentNoteFilename);
    
    if (!result.success) {
      alert('Failed to delete note: ' + result.error);
      return;
    }
    
    closeNoteViewer();
    loadHistory();
  } catch (error) {
    console.error('Error deleting note:', error);
    alert('Failed to delete note');
  }
}

export function setupHistoryListeners(): void {
  const viewHistoryBtn = document.getElementById('viewHistoryBtn');
  const backToMainBtn = document.getElementById('backToMainBtn');
  const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
  const closeNoteBtn = document.getElementById('closeNoteBtn');
  const copyNoteBtn = document.getElementById('copyNoteBtn');
  const deleteNoteBtn = document.getElementById('deleteNoteBtn');
  
  viewHistoryBtn?.addEventListener('click', showHistoryPage);
  backToMainBtn?.addEventListener('click', showMainPage);
  refreshHistoryBtn?.addEventListener('click', () => {
    refreshHistoryBtn.classList.add('spinning');
    loadHistory().finally(() => {
      setTimeout(() => refreshHistoryBtn.classList.remove('spinning'), 500);
    });
  });
  
  closeNoteBtn?.addEventListener('click', closeNoteViewer);
  copyNoteBtn?.addEventListener('click', copyCurrentNote);
  deleteNoteBtn?.addEventListener('click', deleteCurrentNote);
}
