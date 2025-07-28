import nodemailer from "nodemailer";
import Imap from "imap";
import { simpleParser } from "mailparser";
import { inspect } from "util";

// 飞书邮箱配置
const CONFIG = {
  // IMAP 配置（接收邮件）
  imap: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: "imap.feishu.cn",
    port: 993,
    tls: true,
    tlsOptions: {
      rejectUnauthorized: false
    }
  },
  
  // SMTP 配置（发送邮件）
  smtp: {
    host: "smtp.feishu.cn",
    port: 465, // STARTTLS 端口
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false
    }
  },
  
  // 认证规则
  auth: {
    requiredSubject: "CCDC25_verify", // 必须的邮件主题
    requiredContent: "祝coco编辑器四周年快乐!", // 必须包含的内容
    checkInterval: 30000, // 检查邮件间隔（毫秒）
  },
};

// 已处理邮件的 UID 集合（避免重复处理）
const processedEmails = new Set<number>();

// 创建邮件发送器
const transporter = nodemailer.createTransport(CONFIG.smtp);

// 验证邮件内容
function validateEmail(subject: string, content: string): { valid: boolean; reason?: string } {
  const subjectMatch = subject.toLowerCase().includes(CONFIG.auth.requiredSubject.toLowerCase());
  const contentMatch = content.toLowerCase().includes(CONFIG.auth.requiredContent.toLowerCase());
  
  console.log(`📋 邮件验证:`);
  console.log(`   主题验证: ${subjectMatch ? '✅' : '❌'} (要求: "${CONFIG.auth.requiredSubject}", 收到: "${subject}")`);
  console.log(`   内容验证: ${contentMatch ? '✅' : '❌'} (要求包含: "${CONFIG.auth.requiredContent}")`);
  
  if (subjectMatch && contentMatch) {
    return { valid: true };
  }
  
  let reason = "邮件格式不符合要求：";
  if (!subjectMatch) {
    reason += `主题必须包含"${CONFIG.auth.requiredSubject}"；`;
  }
  if (!contentMatch) {
    reason += `内容必须包含"${CONFIG.auth.requiredContent}"；`;
  }
  
  return { valid: false, reason };
}

// 生成认证码
function generateAuthCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase() + 
         Date.now().toString(36).substring(5).toUpperCase();
}

// 发送认证成功邮件
async function sendAuthSuccessEmail(toEmail: string): Promise<void> {
  const authCode = generateAuthCode();
  const timestamp = new Date().toLocaleString('zh-CN');
  
  const mailOptions = {
    from: CONFIG.imap.user,
    to: toEmail,
    subject: "认证成功" ,
    html: `<a href="http://43.159.147.70:16392">前往第7关</a>`,
    text: `第7关：http://43.159.147.70:16392`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ 认证成功邮件已发送到: ${toEmail}`);
    console.log(`📧 邮件ID: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ 发送认证成功邮件失败:`, error);
  }
}

// 发送认证失败邮件
async function sendAuthFailureEmail(toEmail: string, reason: string): Promise<void> {
  const timestamp = new Date().toLocaleString('zh-CN');
  
  const mailOptions = {
    from: CONFIG.imap.user,
    to: toEmail,
    subject: "认证失败",
    html: `<b>无效邮件</b>`,
    text: `无效邮件`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 认证失败邮件已发送到: ${toEmail}`);
    console.log(`📧 邮件ID: ${info.messageId}`);
  } catch (error) {
    console.error(`❌ 发送认证失败邮件失败:`, error);
  }
}

// 处理邮件内容
async function processEmail(buffer: Buffer, uid: number): Promise<void> {
  try {
    const parsed = await simpleParser(buffer);
    
    const fromEmail = parsed.from?.value[0]?.address || "unknown";
    const subject = parsed.subject || "";
    const textContent = parsed.text || "";
    
    console.log(`\n📧 处理新邮件 (UID: ${uid}):`);
    console.log(`   发送方: ${fromEmail}`);
    console.log(`   主题: ${subject}`);
    console.log(`   内容预览: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
    
    // 跳过自己发送的邮件
    if (fromEmail === CONFIG.imap.user) {
      console.log(`⏭️  跳过自己发送的邮件`);
      return;
    }
    
    // 验证邮件内容
    const validation = validateEmail(subject, textContent);
    
    if (validation.valid) {
      console.log(`✅ 邮件验证通过，发送认证成功邮件`);
      await sendAuthSuccessEmail(fromEmail);
    } else {
      console.log(`❌ 邮件验证失败：${validation.reason}`);
      await sendAuthFailureEmail(fromEmail, validation.reason!);
    }
    
  } catch (error) {
    console.error(`❌ 处理邮件时出错:`, error);
  }
}

// IMAP 邮件监听
function startEmailMonitoring(): void {
  const imap = new Imap(CONFIG.imap);
  
  imap.once('ready', function() {
    console.log('✅ IMAP 连接成功');
    
    // 打开收件箱
    imap.openBox('INBOX', false, function(err, box) {
      if (err) {
        console.error('❌ 打开收件箱失败:', err);
        return;
      }
      
      console.log(`📬 收件箱已打开，共有 ${box.messages.total} 封邮件`);
      
      // 检查新邮件
      function checkNewEmails() {
        imap.search(['UNSEEN'], function(err, results) {
          if (err) {
            console.error('❌ 搜索邮件失败:', err);
            return;
          }
          
          if (results.length === 0) {
            console.log('📭 暂无新邮件');
            return;
          }
          
          console.log(`📬 发现 ${results.length} 封新邮件`);
          
          // 获取新邮件内容
          const fetch = imap.fetch(results, { bodies: '' });
          
          fetch.on('message', function(msg, seqno) {
            console.log(seqno, results);
            const uid = results[0];
            
            // 跳过已处理的邮件
            if (processedEmails.has(uid)) {
              return;
            }
            
            processedEmails.add(uid);
            
            msg.on('body', function(stream, info) {
              let buffer = Buffer.alloc(0);
              
              stream.on('data', function(chunk) {
                buffer = Buffer.concat([buffer, chunk]);
              });
              
              stream.once('end', function() {
                processEmail(buffer, uid);
                
                // 标记为已读
                imap.addFlags(uid, ['\\Seen'], function(err) {
                  if (err) {
                    console.error('❌ 标记邮件已读失败:', err);
                  }
                });
              });
            });
          });
          
          fetch.once('error', function(err) {
            console.error('❌ 获取邮件失败:', err);
          });
        });
      }
      
      // 立即检查一次
      checkNewEmails();
      
      // 定期检查新邮件
      setInterval(checkNewEmails, CONFIG.auth.checkInterval);
      
      // 监听新邮件事件
      imap.on('mail', function(numNewMsgs) {
        console.log(`📨 收到 ${numNewMsgs} 封新邮件`);
        setTimeout(checkNewEmails, 1000); // 延迟一秒后检查
      });
    });
  });
  
  imap.once('error', function(err) {
    console.error('❌ IMAP 连接错误:', err);
    
    // 5秒后重新连接
    setTimeout(() => {
      console.log('🔄 尝试重新连接 IMAP...');
      startEmailMonitoring();
    }, 5000);
  });
  
  imap.once('end', function() {
    console.log('🔌 IMAP 连接已断开');
    
    // 3秒后重新连接
    setTimeout(() => {
      console.log('🔄 尝试重新连接 IMAP...');
      startEmailMonitoring();
    }, 3000);
  });
  
  console.log('🔗 正在连接到飞书 IMAP 服务器...');
  imap.connect();
}

// 测试邮件发送功能
async function testEmailConnection(): Promise<void> {
  try {
    console.log('🔍 测试飞书邮箱连接...');
    await transporter.verify();
    console.log('✅ 飞书邮箱 SMTP 连接正常');
  } catch (error) {
    console.error('❌ 飞书邮箱 SMTP 连接失败:', error);
    console.log('🔧 请检查以下配置：');
    console.log('   - EMAIL_USER: 飞书邮箱地址');
    console.log('   - EMAIL_PASS: IMAP/SMTP 密码 (KGSgTfbzZIGMBO9u)');
    process.exit(1);
  }
}

// 主函数
async function main(): Promise<void> {
  console.log('🚀 启动飞书邮箱认证系统...');
  console.log('📋 当前配置：');
  console.log(`   📧 邮箱: ${CONFIG.imap.user}`);
  console.log(`   🔍 检查间隔: ${CONFIG.auth.checkInterval/1000}秒`);
  console.log(`   📝 主题要求: "${CONFIG.auth.requiredSubject}"`);
  console.log(`   📝 内容要求: "${CONFIG.auth.requiredContent}"`);
  
  // 测试连接
  await testEmailConnection();
  
  // 开始监听邮件
  startEmailMonitoring();
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 正在关闭邮件认证系统...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的 Promise 拒绝:', reason);
});

// 启动系统
main().catch(console.error);
