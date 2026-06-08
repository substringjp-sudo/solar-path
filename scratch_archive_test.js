const runArchiveTest = async () => {
  const lat = 37.5665;
  const lon = 126.9780;
  const dateStr = '2025-06-07';

  // 아카이브 API에서 지원하는 변수 목록 테스트
  // direct_normal_irradiance, total_column_integrated_water_vapour 등을 테스트해봄
  const hourlyVariables = 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,precipitation';
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=${hourlyVariables}&timezone=auto`;

  console.log(`Testing Archive API with URL: ${url}`);
  try {
    const res = await fetch(url);
    console.log(`Response Status: ${res.status}`);
    const data = await res.json();
    if (res.status === 200) {
      console.log('Success! Hourly keys:', Object.keys(data?.hourly || {}));
    } else {
      console.log('Error Response:', data);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
};

runArchiveTest();
