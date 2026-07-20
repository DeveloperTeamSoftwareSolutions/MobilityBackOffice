import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import './layout.css';

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className={`bo-layout${sidebarCollapsed ? ' bo-layout--collapsed' : ''}`}
    >
      <TopBar onToggleSidebar={() => setSidebarCollapsed((c) => !c)} />
      <div className="bo-layout__body">
        <Sidebar />
        <main className="bo-layout__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
