import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { NotificationDropdown } from './NotificationDropdown';

function PreferencesProbe() {
  const location = useLocation();
  return <div data-testid="preferences-probe">{location.pathname}</div>;
}

function renderDropdown() {
  return render(
    <MemoryRouter initialEntries={'/'}>
      <Routes>
        <Route
          path="/"
          element={<NotificationDropdown />}
        />
        <Route path="/preferences" element={<PreferencesProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NotificationDropdown', () => {
  it('renders the preferences link as a client-side React Router link', () => {
    renderDropdown();

    const link = screen.getByRole('link', { name: /preferences/i });
    expect(link).toHaveAttribute('href', '/preferences');
    // React Router's <Link> does not set target="_self" or rel="external", and
    // it is an <a> with an internal href. The key regression guard is that
    // clicking it navigates without a full document load.
    expect(link).not.toHaveAttribute('target');
  });

  it('navigates to /preferences via client-side routing without a document reload', () => {
    const { container } = renderDrowpdown();

    const link = screen.getByRole('link', { name: /preferences/i });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    // Fire a real click and assert the browser default (full page load) was
    // prevented. React Router's <Link> calls preventDefault() on internal
    // clicks; a raw <a href> would not.
    fireEvent(link, clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(screen.getByTestId('preferences-probe')).toHaveTextContent('/preferences');
    // The dropdown content should have been replaced by the new route.
    expect(container.querySelector('a')).null;
  });

  it('preserves the preferences link when the dropdown is opened', () => {
    renderDropdown();

    const toggle = screen.getByRole('button', { name: /notifications/i });
    fireEvent(toggle, new MouseEvent('click', { bubbles: true }));

    expect(screen.getByRole('link', { name: /preferences/i })).toHaveAttribute('href', '/preferences');
  });
});
