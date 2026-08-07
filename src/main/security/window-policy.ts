export interface WindowOpenDecision {
  action: 'deny' | 'allow' | 'default';
}

export interface SecureWebContentsLike {
  setWindowOpenHandler(handler: () => WindowOpenDecision): void;
  on(
    event: 'will-navigate' | 'will-attach-webview',
    listener: (event: { preventDefault(): void }) => void,
  ): void;
}

/** Keep application windows pinned to their packaged renderer. */
export function applyWindowSecurity(contents: SecureWebContentsLike): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
