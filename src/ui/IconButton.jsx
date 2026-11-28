export function IconButton({ ref, label, children, onClick, className = "", pressed, disabled = false, type = "button" }) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={typeof pressed === "boolean" ? pressed : undefined}
      className={`icon-button ui-icon-button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
