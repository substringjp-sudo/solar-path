const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. .env 환경변수 파싱 및 로드
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    });
  }
}

// 2. Firebase Admin SDK 초기화
const keyPath = path.join(__dirname, 'p-plan-5c00df855290.json');
let serviceAccount;
try {
  serviceAccount = require(keyPath);
} catch (e) {
  console.error("❌ ERROR: 'functions/p-plan-5c00df855290.json' 서비스 계정 키 파일을 찾을 수 없습니다.");
  console.error("   EAS 빌드 자격 증명 키가 맞는지 확인해 주세요.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 3. 웰컴 메일 발송 함수
async function sendWelcomeEmail(email, userEmail, passWord) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: userEmail,
      pass: passWord,
    },
  });

  const mailOptions = {
    from: `"BeforeGlow Team" <${userEmail}>`,
    to: email,
    subject: "🌅 [BeforeGlow] 오픈 베타 테스트 신청 완료 안내",
    html: `
      <div style="font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e1e4e8; border-radius: 12px; background-color: #ffffff; color: #24292e;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ff7b54; font-size: 24px; font-weight: 800; margin: 0;">🌅 BeforeGlow Beta Test</h1>
        </div>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">안녕하세요,</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">스마트 노을 & 일출 예보 트래커 <strong>BeforeGlow</strong> 오픈 베타 테스터로 신청해 주셔서 대단히 감사합니다!</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">유저님의 구글 계정 이메일(<code>${email}</code>)로 구글 플레이 스토어 내부 테스트 테스터 등록이 완료되었습니다.</p>
        
        <div style="background-color: #fff5f2; border: 1px solid #ffe3db; padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;">
          <h3 style="margin-top: 0; color: #ff7b54; font-size: 18px; font-weight: 600;">📲 앱 다운로드 및 참가하기</h3>
          <p style="font-size: 14px; color: #586069; margin-bottom: 20px; line-height: 1.5;">아래 링크로 접속하여 먼저 테스터 참여 수락(Accept Invitation)을 진행해 주세요. 그 후 구글 플레이에서 다운로드하실 수 있습니다.</p>
          <a href="https://play.google.com/apps/testing/com.pplaner.beforeglow" 
             style="background-color: #ff7b54; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(255, 123, 84, 0.2);">
             베타 테스트 참가 및 설치
          </a>
        </div>

        <p style="font-size: 14px; color: #586069; line-height: 1.6; margin-bottom: 25px;">
          <strong>💡 스토어 이용에 문제가 있으신가요?</strong><br>
          스토어 대신 바로 설치 가능한 APK 파일은 홈페이지 메인 화면의 'Android APK 다운로드' 버튼을 통해서도 언제든 설치하실 수 있습니다.
        </p>

        <p style="font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
          테스트를 진행하며 피드백이나 버그 제보가 있으시면 이 메일의 회신이나 앱 내의 문의 기능을 활용해 전달해 주세요. 보내주시는 따뜻한 조언이 BeforeGlow를 더욱 완벽하게 만드는 밑거름이 됩니다.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #e1e4e8; margin: 30px 0;" />
        <p style="font-size: 12px; color: #888888; text-align: center; line-height: 1.4;">BeforeGlow Team | 본 메일은 발신 전용입니다.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

// 4. 메인 실행 함수
async function main() {
  loadEnv();

  const userVal = process.env.SMTP_USER;
  const passVal = process.env.SMTP_PASS;

  if (!userVal || !passVal || userVal === "your-gmail-account@gmail.com") {
    console.error("❌ ERROR: SMTP_USER 또는 SMTP_PASS 환경 변수가 비어 있거나 올바르지 않습니다.");
    console.error("   루트의 '.env' 파일 설정을 확인해 주세요.");
    process.exit(1);
  }

  console.log("🌅 일괄 웰컴 이메일 발송 작업을 시작합니다...");
  console.log(`발송 계정: ${userVal}`);

  try {
    // welcomeEmailSent가 false인 미발송 대상 문서 조회
    const snapshot = await db.collection("testers")
      .where("welcomeEmailSent", "==", false)
      .get();

    if (snapshot.empty) {
      console.log("✅ 발송 대기 중인 테스터 메일이 없습니다. 모두 발송되었습니다!");
      process.exit(0);
    }

    console.log(`발송 대기자: ${snapshot.size}명`);

    let successCount = 0;
    let failCount = 0;

    for (const doc of snapshot.docs) {
      const tester = doc.data();
      const email = tester.email;

      try {
        console.log(`✉️ ${email} 로 안내 메일 전송 중...`);
        await sendWelcomeEmail(email, userVal, passVal);
        
        // 발송 완료 후 상태 업데이트
        await doc.ref.update({
          welcomeEmailSent: true
        });
        
        console.log(`   └─ ✅ 전송 완료`);
        successCount++;
        
        // Gmail Rate Limit 방지를 위해 1.2초 대기
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`   └─ ❌ 전송 실패:`, err.message);
        failCount++;
      }
    }

    console.log(`\n🎉 일괄 발송 완료`);
    console.log(`- 전체 대상자: ${snapshot.size}명`);
    console.log(`- 발송 성공: ${successCount}명`);
    console.log(`- 발송 실패: ${failCount}명`);

  } catch (err) {
    console.error("❌ 일괄 발송 도중 오류 발생:", err);
    process.exit(1);
  }
}

main();
