import { useCallback, useEffect, useMemo, useState } from 'react';
const convertBiliDataToCSV = data => {
  if (!data || data.length === 0) return '';
  const headers = ['背景图', '标题', '作者', '上传日期', '播放量', '评论数', '时长'];
  const csvRows = [headers.join(',')];
  data.forEach(item => {
    const row = [
      item.bgImg || '',
      `"${(item.title || '').replace(/"/g, '""')}"`,
      `"${(item.author || '').replace(/"/g, '""')}"`,
      item.uploadTime || '',
      item.viewCount || '',
      item.commonCount || '',
      item.duration || '',
    ];
    csvRows.push(row.join(','));
  });
  return csvRows.join('\n');
};
const downloadCSV = (csvContent, filename) => {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
export const isBilibiliPage = url => url.includes('https://search.bilibili.com');
const scrapeBiliVideoData = () => {
  const results = [];
  const videoCards = document.querySelectorAll('div[data-v-712ff254][class*="col_"]');
  videoCards.forEach(card => {
    try {
      const imgElement = card.querySelector('picture img');
      let bgImg = imgElement?.getAttribute('src') || '';
      const avifSource = card.querySelector('source[type="image/avif"]');
      const webpSource = card.querySelector('source[type="image/webp"]');
      if (avifSource) {
        bgImg = avifSource.getAttribute('srcset') || bgImg;
      } else if (webpSource) {
        bgImg = webpSource.getAttribute('srcset') || bgImg;
      }
      const titleElement = card.querySelector('h3[class*="tit"]');
      const title = titleElement?.getAttribute('title') || titleElement?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const authorElement = card.querySelector('span[class*="author"]');
      const author = authorElement?.textContent?.trim() || '';
      const dateElement = card.querySelector('span[class*="date"]');
      let uploadTime = '';
      const fullText = dateElement?.textContent;
      // 正则：匹配 2026-04-21 或 04-21
      const dateMatch = fullText?.match(/(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/);
      if (dateMatch) uploadTime = dateMatch[1];
      const viewElement = card.querySelectorAll('span[class*="stats--item"]')[0];
      const viewCount = viewElement?.textContent?.trim() || '';
      const commentElement = card.querySelectorAll('span[class*="stats--item"]')[1];
      const commonCount = commentElement?.textContent?.trim() || '';
      const durationElement = card.querySelector('span[class*="duration"]');
      const duration = durationElement?.textContent?.trim() || '';
      results.push({
        bgImg: bgImg.startsWith('//') ? 'https:' + bgImg : bgImg,
        title,
        author,
        uploadTime,
        viewCount,
        commonCount,
        duration,
      });
    } catch (error) {
      console.error('解析视频卡片失败:', error);
    }
  });
  return results;
};
export const useBiliScraper = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [currentPageUrl, setCurrentPageUrl] = useState('');
  useEffect(() => {
    chrome.tabs.query({ currentWindow: true, active: true }, tabs => {
      if (tabs[0]?.url) {
        setCurrentPageUrl(tabs[0].url);
      }
    });
  }, []);
  const isBiliPage = useMemo(() => (currentPageUrl ? isBilibiliPage(currentPageUrl) : false), [currentPageUrl]);
  const isButtonDisabled = !isBiliPage || isLoading;
  const handleScrapeBiliData = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    setIsLoading(true);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeBiliVideoData,
      });
      if (results && results[0]?.result) {
        const data = results[0].result;
        if (data.length === 0) {
          alert('未找到任何数据！');
          return;
        }
        const csvContent = convertBiliDataToCSV(data);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `bili-videos-${timestamp}.csv`;
        downloadCSV(csvContent, filename);
        alert(`成功获取 ${data.length} 条数据并已下载！`);
      } else {
        alert('获取数据失败！');
      }
    } catch (error) {
      console.error('爬取数据时出错:', error);
      alert('获取数据时发生错误，请重试！');
    } finally {
      setIsLoading(false);
    }
  }, []);
  return {
    currentPageUrl,
    isBiliPage,
    isButtonDisabled,
    isLoading,
    handleScrapeBiliData,
  };
};
