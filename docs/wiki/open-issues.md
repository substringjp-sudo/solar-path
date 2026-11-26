# 남은 일 — 열린 문제 한곳에

갱신: 2026-11-26. 끝내면 지우고 해당 쪽 · log 에 적을 것.

| 문제 | 상태 | 쪽 |
|---|---|---|
| PR #167(가장자리 거칠기 · 해 쪽 면 · 미세물리 렌더 보정 · 상태 줄) 기기 확인 | 병합됨(2026-11-26), 기기 확인 대기 | [빛](cloud-lighting.md) · [모양](cloud-shape.md) · [미세물리](cloud-microphysics.md) |
| PR #169(끄는 중 미리 굽기) · PR #170(같은 값 최적화) 기기 확인 — 끄는 중 프레임 · 미리 안 구운 칸으로 끌 때 따라오는 속도 | 병합됨(2026-11-26), 기기 확인 대기 | [성능](performance.md) · [최적화 검토](optimization-review.md) |
| #171 뒤 구름이 계속 일렁임 · 프레임 떨어짐 — 다듬기 칩 켬/끔 fps 비교 | 완화 넣음, 기기 확인 대기 | [성능](performance.md) |
| 해 둘레 구름이 전부 하얗게 빛남 — 기기 τ 확인 | 보정을 가정해 적용, 상태 줄로 확인 | [미세물리](cloud-microphysics.md) |
| 해 뜰 무렵 고적운이 큰 덩어리로 붙음(사진은 작은 세포 · 틈) | 미착수 | [배치](cloud-placement.md) |
| 가장자리 거칠기 · 보정 뒤 운량-면적 다시 맞추기 | 미착수 | [모양](cloud-shape.md) |
| 해 쪽 하늘 비대칭을 그늘 하늘빛에 | 미착수 | [빛](cloud-lighting.md) |
| 노을색 곱하기를 노출 · 톤 단계로 | 미착수 | [빛](cloud-lighting.md) |
| 기기 프레임 시간(해 쪽 추적 · 가장자리 잡음 비용) | 기기 측정 필요 — 단계별 ms 계측 없음 | [성능](performance.md) |
| 회전 중 지형 빛 패스 원해상도 재그림 · 해 쪽 추적 비용 | 개선 후보 5개 정리 | [성능](performance.md) |
| 구름 종류 규칙이 자를 못 넘음 | §159 이후 보류 | [배치](cloud-placement.md) |
| T_sun · 아치 빛(해 진 뒤 분홍) | 하네스 도구만, 기본 끔 | [하늘](sky-atmosphere.md) |
| g1-baseline 재측정(G1 도구가 있는 커밋에서) | 보류 | [하네스](harness-verification.md) |
| 미리 실패하는 판정 verify-tsun-* · verify-cirrus-fast | main 에서도 실패 | [하네스](harness-verification.md) |
