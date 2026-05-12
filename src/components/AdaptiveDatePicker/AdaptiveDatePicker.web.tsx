import React, { useEffect } from 'react';

interface AdaptiveDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}

export const AdaptiveDatePicker = ({ value, onChange, onClose }: AdaptiveDatePickerProps) => {
  // On Web, we can use a native date input or just a simple fallback.
  // For simplicity and immediate fix, we'll trigger the change via a hidden input if needed,
  // but since we want to avoid complex web-specific UI now, let's just use a window.prompt or similar 
  // as a placeholder, or better yet, a simple HTML5 date picker.
  
  useEffect(() => {
    // Create a temporary hidden input
    const input = document.createElement('input');
    input.type = 'date';
    input.value = value.toISOString().split('T')[0];
    input.style.position = 'fixed';
    input.style.top = '-100px';
    document.body.appendChild(input);
    
    input.addEventListener('change', (e: any) => {
      const newDate = new Date(e.target.value);
      if (!isNaN(newDate.getTime())) {
        onChange(newDate);
      }
      onClose();
      document.body.removeChild(input);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        onClose();
        if (document.body.contains(input)) document.body.removeChild(input);
      }, 100);
    });

    input.focus();
    input.showPicker?.(); // Modern browsers support this
    if (!input.showPicker) input.click();

    return () => {
      if (document.body.contains(input)) document.body.removeChild(input);
    };
  }, []);

  return null;
};
