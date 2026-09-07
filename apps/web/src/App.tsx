import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './context/AuthContext';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import RoomWizard from './pages/RoomWizard';
import ChatRoom from './pages/ChatRoom';
import RoleStudio from './pages/RoleStudio';
import ModeratorRules from './pages/ModeratorRules';
import DiscussionReview from './pages/DiscussionReview';
import Settings from './pages/Settings';
import EntertainmentLobby from './pages/EntertainmentLobby';
import GameRoomWizard from './pages/GameRoomWizard';
import GameRoom from './pages/GameRoom';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // 正在用 token 换回会话时不能先跳登录页，否则刷新会闪一下登录再跳回来
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

const guarded = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={guarded(<Lobby />)} />
      <Route path="/rooms" element={guarded(<Lobby />)} />
      <Route path="/rooms/new" element={guarded(<RoomWizard />)} />
      <Route path="/rooms/:id" element={guarded(<ChatRoom />)} />
      <Route path="/rooms/:id/moderation" element={guarded(<ModeratorRules />)} />
      <Route path="/rooms/:id/runs/:runId/review" element={guarded(<DiscussionReview />)} />
      <Route path="/entertainment" element={guarded(<EntertainmentLobby />)} />
      <Route path="/entertainment/new" element={guarded(<GameRoomWizard />)} />
      <Route path="/entertainment/:id" element={guarded(<GameRoom />)} />
      <Route path="/roles" element={guarded(<RoleStudio />)} />
      <Route path="/settings" element={guarded(<Settings />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
