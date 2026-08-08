import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import './Dropdown.css';

export default function Dropdown({ value, onChange, options, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    // Hide if scrolling or resizing to prevent detached floating menus
    const handleScrollOrResize = () => setIsOpen(false);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true); // capture phase
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, []);

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width
      });
    }
    setIsOpen(!isOpen);
  };

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <>
      <div className={`custom-dropdown ${className}`} ref={triggerRef}>
        <button 
          type="button" 
          className={`dropdown-trigger ${isOpen ? 'active' : ''}`} 
          onClick={handleToggle}
        >
          <span>{selectedOption?.label}</span>
          <ChevronDown size={14} className={`dropdown-icon ${isOpen ? 'open' : ''}`} />
        </button>
      </div>

      {isOpen && createPortal(
        <div 
          className="dropdown-menu-portal"
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: coords.left,
            top: coords.top,
            minWidth: coords.width,
            zIndex: 999999
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`dropdown-item ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
