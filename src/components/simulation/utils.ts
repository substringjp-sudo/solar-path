export const qualityColor = (quality: string) => {
  switch (quality) {
    case 'Epic': return '#FF007F';
    case 'Great': return '#FF4D4D';
    case 'Fair': return '#FFA500';
    case 'Muted': return '#4DA0B0';
    case 'Overcast': return '#8E8E93';
    default: return '#8E8E93';
  }
};
