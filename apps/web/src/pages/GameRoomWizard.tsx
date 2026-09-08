import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Shell, Top, Notice } from '../components/Shell';

const GAMES = [
  { id: 'werewolf', label: '狼人杀', min: 6, max: 12, desc: '经典身份推理游戏，狼人潜伏在村民中，夜晚杀人，白天投票。' },
  { id: 'who_is_undercover', label: '谁是卧底', min: 4, max: 12, desc: '每人描述自己的词，平民词相同、卧底词不同，投票揪出卧底。' },
  { id: 'murder_mystery', label: '剧本杀', min: 4, max: 8, desc: '沉浸式角色扮演，每人扮演一个角色，推理找出真凶。' },
  { id: 'who_is_the_thief', label: '谁是凶手', min: 4, max: 10, desc: '侦探与小偷的博弈，调查、发言、投票找出小偷。' },
];

export default function GameRoomWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'game' | 'config'>('game');
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [minPlayers, setMinPlayers] = useState(6);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const selected = GAMES.find((g) => g.id === selectedGame);

  const handleCreate = async () => {
    if (!selectedGame || !title.trim()) {
      setProblem('请填写房间名称');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // 人数钳制到游戏规则范围内（后端也会兜底）
      const clampedMin = Math.min(Math.max(minPlayers, 2), selected?.max ?? 20);
      const clampedMax = Math.min(Math.max(maxPlayers, clampedMin), selected?.max ?? 20);
      const room = await api<{ id: string }>('POST', '/entertainment/rooms', {
        title: title.trim(),
        gameType: selectedGame,
        minPlayers: clampedMin,
        maxPlayers: clampedMax,
        visibility,
      });
      navigate(`/entertainment/${room.id}`);
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : '创建失败');
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Top title="创建游戏房间" sub={step === 'game' ? '选择游戏类型' : '配置房间参数'} />
      <div className="content">
        {step === 'game' && (
          <>
            <div className="sectionhead">
              <h3>选择游戏</h3>
            </div>
            <div className="pickgrid">
              {GAMES.map((g) => (
                <button
                  key={g.id}
                  className={`pick ${selectedGame === g.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedGame(g.id);
                    setMinPlayers(g.min);
                    setMaxPlayers(g.max);
                  }}
                >
                  <b>{g.label}</b>
                  <p>{g.desc}</p>
                  <small>
                    {g.min}-{g.max} 人
                  </small>
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => navigate('/entertainment')}>
                取消
              </button>
              <button
                className="primary"
                disabled={!selectedGame}
                onClick={() => {
                  if (selectedGame) {
                    setTitle(`${GAMES.find((g) => g.id === selectedGame)?.label}房间`);
                    setStep('config');
                  }
                }}
              >
                下一步
              </button>
            </div>
          </>
        )}

        {step === 'config' && (
          <>
            <div className="formcard">
              <h2>{selected?.label}房间</h2>
              <label>
                房间名称
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入房间名称"
                  maxLength={120}
                />
              </label>
              <div className="budget" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label>
                  最少人数
                  <input
                    type="number"
                    value={minPlayers}
                    min={2}
                    max={20}
                    onChange={(e) => setMinPlayers(Number(e.target.value))}
                  />
                  <small>范围 {selected?.min}-{selected?.max} 人</small>
                </label>
                <label>
                  最多人数
                  <input
                    type="number"
                    value={maxPlayers}
                    min={2}
                    max={20}
                    onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="toggle">
                <span>
                  可见性
                  <small>公开房间任何人可见，私有房间仅邀请可见</small>
                </span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                >
                  <option value="public">公开</option>
                  <option value="private">私有</option>
                </select>
              </label>
            </div>
            {problem && <Notice kind="error">{problem}</Notice>}
            <div className="actions">
              <button className="secondary" onClick={() => setStep('game')}>
                上一步
              </button>
              <button className="primary" onClick={handleCreate} disabled={busy}>
                {busy ? '创建中...' : '创建房间'}
              </button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
