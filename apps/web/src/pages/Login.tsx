import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { describeError } from '../lib/api';
import { Shell, Top } from '../components/Shell';

type Mode = 'login' | 'register';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 登录前被守卫拦下来的路径，成功后要回去
  const from = (location.state as { from?: string } | null)?.from ?? '/rooms';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, displayName.trim());
      navigate(from, { replace: true });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Top
        title={mode === 'login' ? '登录' : '注册新账号'}
        sub={mode === 'login' ? '进入你的讨论空间' : '创建账号后即可建立多角色讨论室'}
      />
      <section className="content narrow">
        <form className="formcard" onSubmit={(event) => void submit(event)}>
          <span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span>
          <h2>{mode === 'login' ? '用邮箱和密码进入' : '给自己起个名字'}</h2>

          <label>
            邮箱
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          {mode === 'register' && (
            <label>
              昵称
              <input
                value={displayName}
                maxLength={64}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          )}

          <label>
            密码
            <input
              type="password"
              value={password}
              minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {mode === 'register' && <p className="hint">密码至少 8 位。</p>}

          {error && <div className="notice error">{error}</div>}

          <div className="actions">
            <button className="secondary" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {mode === 'login' ? <LogIn /> : <UserPlus />}
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}
            </button>
          </div>
          <p className="hint">
            开发环境可先用种子账号 <code>owner@tianma.dev / tianma-demo</code>
            ，或 <Link to="/rooms">直接试试</Link>
          </p>
        </form>
      </section>
    </Shell>
  );
}
