import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Home, LogOut, Settings, Shield, SlidersHorizontal, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/** v6 的 NavLink 用 className 回调表达激活态，没有 activeClassName */
function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
      {icon}
      {label}
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="brandmark">天</span>
          <div>
            <b>天马不行空</b>
            <small>AI DISCUSSION SPACE</small>
          </div>
        </div>
        <nav>
          <NavItem to="/rooms" icon={<Home />} label="聊天室" />
          <NavItem to="/roles" icon={<Users />} label="角色工坊" />
          <NavItem to="/settings" icon={<Settings />} label="设置" />
        </nav>
        <div className="sidefoot">
          {user ? (
            <button className="signout" onClick={logout} title={user.email}>
              <LogOut />
              {user.displayName}
            </button>
          ) : (
            <Link to="/login">登录</Link>
          )}
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}

export function Top({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: ReactNode;
}) {
  return (
    <header className="top">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </header>
  );
}

/** 各页共用的空态与错误态，避免每页自己发明一套提示样式 */
export function Notice({ kind, children }: { kind: 'info' | 'error'; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{kind === 'error' ? <Shield /> : <Sparkles />}<span>{children}</span></div>;
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="sectionhead">
      <h3>{title}</h3>
      {right ?? <SlidersHorizontal />}
    </div>
  );
}
