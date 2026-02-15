import { getProviderColor, getProviderIcon, getProviderLabel } from '../lib/provider-colors';
import type { ProviderId } from '../lib/types';

type BadgeSize = 'xs' | 'sm' | 'md';

interface ProviderBadgeProps {
  provider: ProviderId;
  size?: BadgeSize;
  showLabel?: boolean;
}

const sizeConfig: Record<BadgeSize, { classes: string; icon: number; text: string }> = {
  xs: { classes: 'px-1 py-0.5 gap-0.5', icon: 8, text: 'text-[9px]' },
  sm: { classes: 'px-1.5 py-1 gap-1', icon: 10, text: 'text-[10px]' },
  md: { classes: 'px-2 py-1.5 gap-1.5', icon: 12, text: 'text-xs' },
};

export default function ProviderBadge({
  provider,
  size = 'sm',
  showLabel = false,
}: ProviderBadgeProps): React.ReactElement {
  const color = getProviderColor(provider);
  const Icon = getProviderIcon(provider);
  const { classes, icon, text } = sizeConfig[size];

  return (
    <div
      className={`inline-flex items-center rounded ${classes}`}
      style={{
        backgroundColor: `${color.primary}15`,
        border: `1px solid ${color.primary}30`,
      }}
    >
      <Icon size={icon} style={{ color: color.light }} />
      {showLabel && (
        <span
          className={`font-medium ${text}`}
          style={{ color: color.light }}
        >
          {getProviderLabel(provider)}
        </span>
      )}
    </div>
  );
}
