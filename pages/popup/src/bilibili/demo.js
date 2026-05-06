function extractVideoDataEnhanced() {
  const results = [];

  // 通过data属性定位视频卡片（这是最稳定的方式）
  const videoCards = document.querySelectorAll('div[data-v-712ff254][class*="col_"]');

  videoCards.forEach((card, index) => {
    try {
      // 1. 背景图 - 优先获取高清图片链接
      const imgElement = card.querySelector('picture img');
      let bgImg = imgElement?.getAttribute('src') || '';

      // 尝试获取avif或webp格式的高清图
      const avifSource = card.querySelector('source[type="image/avif"]');
      const webpSource = card.querySelector('source[type="image/webp"]');
      if (avifSource) {
        bgImg = avifSource.getAttribute('srcset') || bgImg;
      } else if (webpSource) {
        bgImg = webpSource.getAttribute('srcset') || bgImg;
      }

      // 2. 标题 - 去除HTML标签和多余空格
      const titleElement = card.querySelector('h3[class*="tit"]');
      let title = titleElement?.getAttribute('title') || titleElement?.textContent?.replace(/\s+/g, ' ').trim() || '';

      // 3. 作者 - 提取纯文本
      const authorElement = card.querySelector('span[class*="author"]');
      const author = authorElement?.textContent?.trim() || '';

      // 4. 上传日期 - 从完整文本中提取
      const ownerSection = card.querySelector('a[class*="owner"]');
      let uploadTime = '';
      if (ownerSection) {
        const fullText = ownerSection.textContent;
        const dateMatch = fullText.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          uploadTime = dateMatch[1];
        }
      }

      // 5. 播放量 - 清理单位
      const viewElement = card.querySelectorAll('span[class*="stats--item"]')[0];
      let viewCount = viewElement?.textContent?.trim() || '';

      // 6. 评论数/弹幕数
      const commentElement = card.querySelectorAll('span[class*="stats--item"]')[1];
      let commonCount = commentElement?.textContent?.trim() || '';

      // 7. 时长 - 标准格式
      const durationElement = card.querySelector('span[class*="duration"]');
      const duration = durationElement?.textContent?.trim() || '';

      results.push({
        index: index + 1,
        bgImg: bgImg.startsWith('//') ? 'https:' + bgImg : bgImg, // 补全协议
        title,
        author,
        uploadTime,
        viewCount,
        commonCount,
        duration,
      });
    } catch (error) {
      console.error(`解析第${index + 1}个视频卡片失败:`, error);
    }
  });

  return results;
}

// 执行增强版
const videoDataEnhanced = extractVideoDataEnhanced();
console.table(videoDataEnhanced);
// 导出为JSON（方便后续处理）
console.log('JSON格式数据:', JSON.stringify(videoDataEnhanced, null, 2));
