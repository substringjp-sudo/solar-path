// 하네스(브라우저) 묶기용 expo-file-system/legacy 대체. 웹 경로에서는 부르지 않습니다.
export const documentDirectory = null;
const no = () => { throw new Error('expo-file-system stub: not available in the harness'); };
export const getInfoAsync = no, makeDirectoryAsync = no, downloadAsync = no, readDirectoryAsync = no, deleteAsync = no;
