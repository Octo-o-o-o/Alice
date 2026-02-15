import { useState } from 'react';
import { CheckCircle2, XCircle, FolderOpen } from 'lucide-react';
import { getProviderIcon, getProviderColor } from '../lib/provider-colors';
import type { ProviderStatus } from '../lib/types';

interface ProviderConfigCardProps {
  provider: ProviderStatus;
  onToggle: (enabled: boolean) => void;
  onDataDirChange?: (dataDir: string | null) => void;
}

export default function ProviderConfigCard({
  provider,
  onToggle,
  onDataDirChange,
}: ProviderConfigCardProps) {
  const Icon = getProviderIcon(provider.id);
  const color = getProviderColor(provider.id);
  const [isExpanded, setIsExpanded] = useState(false);
  const [customDataDir, setCustomDataDir] = useState(provider.custom_data_dir || '');

  const handleDataDirSave = () => {
    onDataDirChange?.(customDataDir.trim() || null);
    setIsExpanded(false);
  };

  const StatusIcon = provider.installed ? CheckCircle2 : XCircle;
  const statusColor = provider.installed ? 'green' : 'yellow';
  const statusText = provider.installed
    ? `Installed${provider.version ? ` · ${provider.version}` : ''}`
    : 'Not installed';

  const toggleTitle = provider.installed
    ? (provider.enabled ? 'Disable' : 'Enable')
    : 'Not installed';

  return (
    <div
      className="bg-white/[0.03] border border-white/5 rounded-lg p-3"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: provider.enabled ? color.primary : '#374151',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded flex items-center justify-center"
            style={{
              backgroundColor: `${color.primary}15`,
              border: `1px solid ${color.primary}30`,
            }}
          >
            <Icon size={16} style={{ color: color.light }} />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-200">
              {provider.display_name}
            </h4>
            <div className="flex items-center gap-1 mt-0.5">
              <StatusIcon size={10} className={`text-${statusColor}-500`} />
              <span className={`text-[10px] text-${statusColor}-400`}>
                {statusText}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => onToggle(!provider.enabled)}
          disabled={!provider.installed}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            provider.enabled ? 'bg-blue-500' : 'bg-gray-700'
          } ${!provider.installed ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={toggleTitle}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              provider.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className="text-xs text-gray-500 flex items-start gap-1 mt-2">
        <FolderOpen size={12} className="mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-mono truncate block">
            {provider.custom_data_dir || provider.data_dir}
          </span>
          {provider.custom_data_dir && (
            <span className="text-[10px] text-gray-600 mt-0.5 block">
              Custom directory
            </span>
          )}
        </div>
      </div>

      {provider.enabled && onDataDirChange && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            {isExpanded ? '▼' : '▶'} Advanced settings
          </button>

          {isExpanded && (
            <div className="mt-2">
              <label className="text-[10px] text-gray-500 block mb-1">
                Custom Data Directory (optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customDataDir}
                  onChange={(e) => setCustomDataDir(e.target.value)}
                  placeholder={provider.data_dir}
                  className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                />
                <button
                  onClick={handleDataDirSave}
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
                >
                  Save
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1">
                Leave empty to use default: {provider.data_dir}
              </p>
            </div>
          )}
        </div>
      )}

      {!provider.installed && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <p className="text-xs text-yellow-500/80">
            ⚠️ CLI not found. Install <code className="text-gray-400">{provider.id}</code> first.
          </p>
        </div>
      )}
    </div>
  );
}
