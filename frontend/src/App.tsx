import { Routes, Route } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import TitleBar from './components/TitleBar';
import ProjectsPage from './pages/ProjectsPage';
import CollectionPage from './pages/CollectionPage';
import WorkflowEditor from './pages/WorkflowEditor';
import SettingsPage from './pages/SettingsPage';
import PlaygroundPage from './pages/PlaygroundPage';
import './App.css';
import './styles/cursors.css';

export default function App() {
  return (
    <div className="app-shell">
      <TitleBar />
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route
          path="/workflow/:id"
          element={
            <ReactFlowProvider>
              <WorkflowEditor />
            </ReactFlowProvider>
          }
        />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
