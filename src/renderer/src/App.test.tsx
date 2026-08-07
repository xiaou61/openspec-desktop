import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('shows the local project onboarding action', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'OpenSpec Desktop' })).toBeVisible();
    expect(screen.getByRole('button', { name: '添加本地项目' })).toBeEnabled();
  });
});
