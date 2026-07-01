const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const path = require("path");

// Firebase Admin SDK 초기화
admin.initializeApp();
const db = admin.firestore();

// 환경 변수는 process.env.SMTP_USER, process.env.SMTP_PASS로 주입됩니다.
const packageName = "com.pplaner.beforeglow";
const keyPath = path.join(__dirname, "p-plan-5c00df855290.json");
const key = require(keyPath);

// Google Play Developer API v3는 개별 이메일 직접 추가를 지원하지 않으므로 (Google Groups만 지원),
// 테스터 개별 API 추가 함수(addTesterToGooglePlay)는 제거되었으며, 수집된 이메일은 Play Console에서 수동 업로드하여 등록합니다.

/**
 * 테스터 환영 및 다운로드 링크 발송 이메일 전송
 */
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
  console.log(`Welcome email sent successfully to ${email}.`);
}

/**
 * 클라이언트에서 호출 가능한 registerBetaTester Callable 함수
 */
exports.registerBetaTester = onCall(async (request) => {
  const email = request.data.email;

  // 1. 유효성 검사
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "올바른 구글 이메일 주소를 입력해 주세요.");
  }

  try {
    // 2. Firestore 중복 신청 체크
    const testerDoc = await db.collection("testers").doc(email).get();
    if (testerDoc.exists) {
      throw new HttpsError("already-exists", "이미 베타테스트에 등록된 이메일 주소입니다.");
    }

    // 3. Google Play 테스터 추가 API 호출 건너뛰기
    // 개별 이메일 추가 API 미지원으로 인해 API 직접 등록은 false로 기록하고
    // Firestore 수집 후 추후 일괄 등록합니다.
    const isAdded = false;

    // 4. Firestore 기록 저장
    await db.collection("testers").doc(email).set({
      email: email,
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      googlePlayRegistered: isAdded,
      welcomeEmailSent: false
    });

    return {
      success: true,
      message: "베타 테스터 신청이 성공적으로 완료되었습니다. 테스터 등록 완료 후 기입하신 메일로 안내가 발송될 예정입니다!",
    };
  } catch (error) {
    console.error("Error registering beta tester:", error);
    
    // 이미 던져진 HttpsError는 그대로 전송
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError("internal", `베타테스트 등록 처리 중 서버 에러가 발생했습니다: ${error.message}`);
  }
});
