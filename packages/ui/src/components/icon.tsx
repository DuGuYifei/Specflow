export type IconName =
  | 'plus' | 'play' | 'play-line' | 'pause' | 'edit' | 'trash' | 'x'
  | 'search' | 'chevron-right' | 'chevron-down' | 'chevron-up'
  | 'lock' | 'image' | 'folder' | 'file' | 'paperclip'
  | 'flow' | 'workflow' | 'play-circle' | 'history' | 'settings'
  | 'external' | 'check' | 'alert' | 'loader' | 'sparkle' | 'tag'
  | 'zoom-in' | 'zoom-out' | 'fit' | 'hand' | 'connect' | 'rotate'
  | 'list' | 'logs' | 'star' | 'arrow-right' | 'arrow-down' | 'more'
  | 'attachment-img' | 'route' | 'link' | 'sun' | 'moon' | 'terminal';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 14, className = '', style }: IconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style: { width: size, height: size, ...style },
  };
  switch (name) {
    case 'plus':          return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'play':          return <svg {...props}><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/></svg>;
    case 'play-line':     return <svg {...props}><path d="M7 4v16l13-8z"/></svg>;
    case 'pause':         return <svg {...props}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
    case 'edit':          return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>;
    case 'trash':         return <svg {...props}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>;
    case 'x':             return <svg {...props}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case 'search':        return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'chevron-right': return <svg {...props}><path d="m9 6 6 6-6 6"/></svg>;
    case 'chevron-down':  return <svg {...props}><path d="m6 9 6 6 6-6"/></svg>;
    case 'chevron-up':    return <svg {...props}><path d="m18 15-6-6-6 6"/></svg>;
    case 'lock':          return <svg {...props}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>;
    case 'image':         return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>;
    case 'folder':        return <svg {...props}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
    case 'file':          return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>;
    case 'paperclip':     return <svg {...props}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
    case 'flow':          return <svg {...props}><rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="15" y="15" width="6" height="6" rx="1.2"/><path d="M9 6h4a3 3 0 0 1 3 3v6"/></svg>;
    case 'workflow':      return <svg {...props}><rect x="3" y="3" width="8" height="6" rx="1"/><rect x="13" y="15" width="8" height="6" rx="1"/><path d="M7 9v3a3 3 0 0 0 3 3h3"/></svg>;
    case 'play-circle':   return <svg {...props}><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>;
    case 'history':       return <svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>;
    case 'settings':      return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.39.16.74.41 1 .73a2 2 0 0 1 0 2.54c-.26.32-.61.57-1 .73"/></svg>;
    case 'external':      return <svg {...props}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
    case 'check':         return <svg {...props}><path d="m20 6-11 11-5-5"/></svg>;
    case 'alert':         return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>;
    case 'loader':        return <svg {...props}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>;
    case 'sparkle':       return <svg {...props}><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/></svg>;
    case 'tag':           return <svg {...props}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/></svg>;
    case 'zoom-in':       return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M21 21l-4.3-4.3"/></svg>;
    case 'zoom-out':      return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M8 11h6M21 21l-4.3-4.3"/></svg>;
    case 'fit':           return <svg {...props}><path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4"/></svg>;
    case 'hand':          return <svg {...props}><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>;
    case 'connect':       return <svg {...props}><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 12h7"/></svg>;
    case 'rotate':        return <svg {...props}><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>;
    case 'list':          return <svg {...props}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>;
    case 'logs':          return <svg {...props}><path d="M14 3v18M3 8h6M3 12h6M3 16h6M14 8h7M14 12h7M14 16h7"/></svg>;
    case 'star':          return <svg {...props}><path d="M12 2l3 7 7 .5-5.5 4.5L18 22l-6-3.8L6 22l1.5-7.5L2 9.5 9 9z"/></svg>;
    case 'arrow-right':   return <svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case 'arrow-down':    return <svg {...props}><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
    case 'more':          return <svg {...props}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case 'attachment-img': return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21"/></svg>;
    case 'route':         return <svg {...props}><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V8a2 2 0 0 1 2-2h6"/><path d="m12 14 6-6"/></svg>;
    case 'link':          return <svg {...props}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>;
    case 'sun':           return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>;
    case 'moon':          return <svg {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
    case 'terminal':      return <svg {...props}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
    default:              return null;
  }
}
