import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AgentProfile } from '@tianma/contracts';
import { api, describeError } from '../lib/api';
import { Notice, Shell, Top } from '../components/Shell';

export default function RoleStudio() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    tagline: '',
    description: '',
    systemPrompt: '',
    rationality: 60,
    aggressiveness: 40,
  });

  const load = () =>
    api<AgentProfile[]>('GET', '/profiles')
      .then(setProfiles)
      .catch((error: unknown) => setProblem(describeError(error)));

  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    setProblem(null);
    try {
      await api('POST', '/profiles', form);
      setCreating(false);
      setForm({ name: '', tagline: '', description: '', systemPrompt: '', rationality: 60, aggressiveness: 40 });
      await load();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const remove = async (profile: AgentProfile) => {
    try {
      await api('DELETE', `/profiles/${profile.id}`);
      await load();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Shell>
      <Top
        title="角色工坊"
        sub="预置人格，也允许你从零塑造一个新声音"
        action={
          <button className="primary" onClick={() => setCreating((value) => !value)}>
            <Plus />
            创建角色
          </button>
        }
      />
      <section className="content">
        {problem && <Notice kind="error">{problem}</Notice>}

        {creating && (
          <div className="formcard">
            <span className="eyebrow">NEW ROLE</span>
            <h2>塑造一个新声音</h2>
            <label>
              名称
              <input value={form.name} maxLength={64} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              一句话定位
              <input
                value={form.tagline}
                maxLength={120}
                onChange={(event) => setForm({ ...form, tagline: event.target.value })}
              />
            </label>
            <label>
              简介
              <input
                value={form.description}
                maxLength={4000}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <label>
              系统提示（决定这个角色怎么说话）
              <textarea
                value={form.systemPrompt}
                onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
              />
            </label>
            <div className="budget">
              <label>
                理性 {form.rationality}
                <input
                  type="range"
                  value={form.rationality}
                  onChange={(event) => setForm({ ...form, rationality: Number(event.target.value) })}
                />
              </label>
              <label>
                攻击性 {form.aggressiveness}
                <input
                  type="range"
                  value={form.aggressiveness}
                  onChange={(event) => setForm({ ...form, aggressiveness: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="primary" onClick={() => void submit()} disabled={!form.name.trim() || !form.systemPrompt.trim()}>
                保存
              </button>
            </div>
          </div>
        )}

        <div className="rolegrid">
          {profiles.map((profile) => (
            <div className="rolecard" key={profile.id}>
              <span className="avatar xl" style={{ background: profile.avatarColor }}>
                {profile.name.slice(0, 1)}
              </span>
              <small>{profile.isBuiltIn ? '内置角色' : '我的模板'}</small>
              <h2>{profile.name}</h2>
              <b>{profile.tagline}</b>
              <p>{profile.description}</p>
              <div>
                <span>理性 {profile.rationality}%</span>
                <span>攻击性 {profile.aggressiveness}%</span>
              </div>
              {profile.isBuiltIn ? (
                <button className="secondary" disabled>
                  内置模板不可删除
                </button>
              ) : (
                <button className="secondary" onClick={() => void remove(profile)}>
                  <Trash2 />
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
        {profiles.length === 0 && <Notice kind="info">角色库是空的。跑一次 <code>pnpm db:seed</code> 会带上 4 个内置模板。</Notice>}
      </section>
    </Shell>
  );
}
