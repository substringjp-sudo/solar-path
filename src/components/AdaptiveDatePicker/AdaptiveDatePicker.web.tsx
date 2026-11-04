import React from 'react';
import { CustomCalendarModal } from './CustomCalendarModal';

interface AdaptiveDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}

export const AdaptiveDatePicker = ({ value, onChange, onClose }: AdaptiveDatePickerProps) => {
  return (
    <CustomCalendarModal
      visible={true}
      value={value}
      onChange={onChange}
      onClose={onClose}
    />
  );
};
