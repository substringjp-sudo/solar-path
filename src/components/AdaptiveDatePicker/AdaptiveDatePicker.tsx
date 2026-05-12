import React from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';

interface AdaptiveDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}

export const AdaptiveDatePicker = ({ value, onChange, onClose }: AdaptiveDatePickerProps) => {
  return (
    <DateTimePicker
      value={value}
      mode="date"
      display="default"
      onChange={(event, selectedDate) => {
        onClose();
        if (selectedDate) onChange(selectedDate);
      }}
    />
  );
};
