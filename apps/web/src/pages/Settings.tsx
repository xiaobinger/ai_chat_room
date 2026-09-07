import { useState } from 'react';
import { DEFAULT_RUN_SETTINGS } from '@tianma/contracts';
import { useAuth } from '../context/AuthContext';
import { Shell, Top } from '../components/Shell';
import { getToken } from '../lib/api';

const STORAGE_KEY = 'tianma.defaultRunSettings';

interface Defaults {
  maxRounds: number;
  tokenBudget: number;
  maxConsecutiveTurns: number;
  aiTimeoutSeconds: number;
}

function readDefaults(): Defaults {
  const base = {
    maxRounds: DEFAULT_RUN_SETTINGS.maxRounds,
    tokenBudget: DEFAULT_RUN_SETTINGS.tokenBudget,
    maxConsecutiveTurns: DEFAULT_RUN_SETTINGS.maxConsecutiveTurns,
    aiTimeoutSeconds: DEFAULT_RUN_SETTINGS.aiTimeoutSeconds,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<Defaults>) } : base;
  } catch {
    return base;
  }
}

export default function Settings() {
  const { user } = useAuth();
  const [defaults, setDefaults] = useState<Defaults>(readDefaults);
  const [health, setHealth] = useState<{ queue: string; envFile: string | null } | null>(null);

  const save = (next: Defaults) => {
    setDefaults(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <Shell>
      <Top title="设置" sub="账号信息与建房时的默认讨论上限" />
      <section className="content">
        <div className="formcard">
          <span className="eyebrow">ACCOUNT</span>
          <h2>{user?.displayName ?? '未登录'}</h2>
          <div className="summary">
            <p>
              <b>邮箱</b>
              <span>{user?.email ?? '—'}</span>
            </p>
            <p>
              <b>登录状态</b>
              <span>{getToken() ? '有效' : '未登录'}</span>
            </p>
            <p>
              <b>后端连通</b>
              <span>
                <button
                  className="secondary"
                  onClick={() =>
                    void fetch('/health')
                      .then((response) => response.json())
                      .then((value: { queue: string; envFile: string | null }) => setHealth(value))
                      .catch(() => setHealth({ queue: 'unreachable', envFile: null }))
                  }
                >
                  测一下
                </button>
                {health ? ` 队列驱动 ${health.queue}` : ''}
              </span>
            </p>
          </div>
        </div>

        <div className="formcard">
          <h2>默认讨论上限</h2>
          <p className="hint">这些值只填进创建向导的初始表单，存在本浏览器；每个房间仍可单独调整。</p>
          <div className="budget">
            <label>
              最大轮次（硬顶 100）
              <input
                type="number"
                min={1}
                max={100}
                value={defaults.maxRounds}
                onChange={(event) => save({ ...defaults, maxRounds: Number(event.target.value) })}
              />
            </label>
            <label>
              Token 预算
              <input
                type="number"
                min={100}
                step={500}
                value={defaults.tokenBudget}
                onChange={(event) => save({ ...defaults, tokenBudget: Number(event.target.value) })}
              />
            </label>
            <label>
              单角色最大连续轮次
              <input
                type="number"
                min={1}
                max={10}
                value={defaults.maxConsecutiveTurns}
                onChange={(event) => save({ ...defaults, maxConsecutiveTurns: Number(event.target.value) })}
              />
            </label>
            <label>
              单次模型调用超时（秒）
              <input
                type="number"
                min={5}
                max={600}
                value={defaults.aiTimeoutSeconds}
                onChange={(event) => save({ ...defaults, aiTimeoutSeconds: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>
      </section>
    </Shell>
  );
}
