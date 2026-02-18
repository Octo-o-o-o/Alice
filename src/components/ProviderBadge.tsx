import type { ReactElement } from 'react';

import { getProviderColor, getProviderIcon, getProviderLabel } from '../lib/provider-colors';
import type { ProviderId } from '../lib/types';

type BadgeSize = 'xs' | 'sm' | 'md';

interface SizeConfig {
  classes: string;
  iconSize: number;
  textClass: string;
}

export interface ProviderBadgeProps {
  provider: ProviderId;
  size?: BadgeSize;
  showLabel?: boolean;
}

const SIZE_CONFIG: Record<BadgeSize, SizeConfig> = {
  xs: { classes: 'px-1 py-0.5 gap-0.5', iconSize: 8, textClass: 'text-[9px]' },
  sm: { classes: 'px-1.5 py-1 gap-1', iconSize: 10, textClass: 'text-[10px]' },
  md: { classes: 'px-2 py-1.5 gap-1.5', iconSize: 12, textClass: 'text-xs' },
};

export default function ProviderBadge({
  provider,
  size = 'sm',
  showLabel = false,
}: ProviderBadgeProps): ReactElement {
  const color = getProviderColor(provider);
  const Icon = getProviderIcon(provider);
  const { classes, iconSize, textClass } = SIZE_CONFIG[size];

  return (
    <div
      className={`inline-flex items-center rounded ${classes}`}
      style={{
        backgroundColor: `${color.primary}15`,
        border: `1px solid ${color.primary}30`,
      }}
    >
      <Icon size={iconSize} style={{ color: color.light }} />
      {showLabel && (
        <span
          className={`font-medium ${textClass}`}
          style={{ color: color.light }}
        >
          {getProviderLabel(provider)}
        </span>
      )}
    </div>
  );
}
