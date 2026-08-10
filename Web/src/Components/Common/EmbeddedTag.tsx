// Small pill marking an embedded from-base upload — a bsdiff base for the first
// OTA after install, not a servable update. Mirrors StatusPill's visual style so
// update tables stay visually consistent.
export const EmbeddedTag = ({ platform }: { platform?: string }) => (
  <span
    title="Embedded from-base — a bsdiff base for the first OTA after install, not a servable update"
    style={{
      padding: '1px 6px',
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 600,
      backgroundColor: 'rgba(124, 92, 255, 0.22)',
      color: '#c9bbff',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      whiteSpace: 'nowrap',
    }}>
    {platform ? `embedded · ${platform}` : 'embedded'}
  </span>
)
