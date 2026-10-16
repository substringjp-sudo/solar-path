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
    // 기기 지역 날짜로 적습니다(toISOString 은 UTC 날짜라 서쪽 기기에서는 하루 어긋납니다).
    input.value = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    input.style.position = 'fixed';
    input.style.top = '-100px';
    document.body.appendChild(input);
    
    input.addEventListener('change', (e: any) => {
      // 'yyyy-mm-dd' 를 `new Date(문자열)` 로 읽으면 UTC 자정이라 서쪽 기기에서 전날이 됩니다 — 기기 지역 정오로 만듭니다.
      const [yy, mm, dd] = String(e.target.value).split('-').map(Number);
      const newDate = new Date(yy, (mm || 1) - 1, dd || 1, 12);
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
