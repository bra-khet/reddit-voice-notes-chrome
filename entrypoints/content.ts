import { initRedditVoiceNotes } from '@/src/reddit-injector';

export default defineContentScript({
  matches: ['https://www.reddit.com/*', 'https://reddit.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Reddit Voice Notes] Content script loaded on', location.hostname);
    initRedditVoiceNotes();
  },
});