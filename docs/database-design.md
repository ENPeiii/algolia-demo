# 部落格文章資料庫設計

## 資料庫 Schema 設計

### 1. 分類表 (categories)
```sql
CREATE TABLE categories (
  id          VARCHAR(36) PRIMARY KEY,  -- UUID
  name        VARCHAR(50) NOT NULL,     -- 技術文、生活文
  slug        VARCHAR(50) NOT NULL UNIQUE,
  sortOrder   INT DEFAULT 0,
  createdAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 2. 主題表 (topics)
```sql
CREATE TABLE topics (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,    -- Leetcode 刷題、Angular 學習筆記
  slug        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  sortOrder   INT DEFAULT 0,
  createdAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 3. 標籤表 (tags)
```sql
CREATE TABLE tags (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  slug        VARCHAR(50) NOT NULL UNIQUE,
  createdAt   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4. 文章主表 (articles)
```sql
CREATE TABLE articles (
  id            VARCHAR(36) PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  slug          VARCHAR(200) NOT NULL UNIQUE,  -- URL 路徑
  excerpt       TEXT,                          -- 文章摘要（給 Algolia 搜尋用）
  content       LONGTEXT,                      -- 完整文章內容（Markdown）
  categoryId    VARCHAR(36) NOT NULL,
  topicId       VARCHAR(36),                   -- 可為 NULL（一般文章）
  coverImage    VARCHAR(500),                  -- 封面圖 URL
  status        ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  publishedAt   TIMESTAMP,                     -- 發布時間
  createdAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- 索引
  FOREIGN KEY (categoryId) REFERENCES categories(id),
  FOREIGN KEY (topicId) REFERENCES topics(id),
  INDEX idx_status (status),
  INDEX idx_publishedAt (publishedAt DESC),
  INDEX idx_category_topic (categoryId, topicId)
);
```

### 5. 文章標籤關聯表 (article_tags)
```sql
CREATE TABLE article_tags (
  articleId   VARCHAR(36) NOT NULL,
  tagId       VARCHAR(36) NOT NULL,
  PRIMARY KEY (articleId, tagId),
  FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

## Algolia 同步資料格式

當文章更新時，轉換成以下格式同步到 Algolia：

```typescript
interface AlgoliaArticle {
  objectID: string;           // 同 articles.id
  
  // DocSearch 階層結構
  hierarchy: {
    lvl0: string;             // category.name (技術文/生活文)
    lvl1: string;             // topic.name 或 "一般文章"
    lvl2: string;             // article.title
  };
  
  // 搜尋內容
  content: string;            // article.excerpt
  url: string;                // `/blog/${article.slug}`
  
  // 額外欄位（用於篩選/排序）
  categoryId: string;
  categoryName: string;
  topicId: string | null;
  topicName: string | null;
  tags: string[];             // 標籤名稱陣列
  
  // 時間（用於排序）
  publishedAt: string;        // ISO 8601 格式
  publishedAtTimestamp: number;  // Unix timestamp（Algolia 排序用）
}
```

---

## 同步策略建議

### 方式一：即時同步（推薦小型專案）
```typescript
// 後台儲存文章時
async function saveArticle(article: Article) {
  // 1. 儲存到資料庫
  await db.articles.upsert(article);
  
  // 2. 只有已發布的文章才同步到 Algolia
  if (article.status === 'published') {
    const algoliaRecord = transformToAlgoliaFormat(article);
    await algoliaIndex.saveObject(algoliaRecord);
  } else {
    // 下架或草稿 -> 從 Algolia 刪除
    await algoliaIndex.deleteObject(article.id);
  }
}
```

### 方式二：事件驅動（推薦中大型專案）
```
[後台更新] → [資料庫] → [觸發事件] → [Message Queue] → [Algolia Sync Worker]
```

### 方式三：定時批次同步
```typescript
// 每 5 分鐘執行一次
async function batchSyncToAlgolia() {
  const recentlyUpdated = await db.articles.findMany({
    where: { updatedAt: { gte: fiveMinutesAgo } }
  });
  
  const toSave = recentlyUpdated
    .filter(a => a.status === 'published')
    .map(transformToAlgoliaFormat);
    
  const toDelete = recentlyUpdated
    .filter(a => a.status !== 'published')
    .map(a => a.id);
    
  await algoliaIndex.saveObjects(toSave);
  await algoliaIndex.deleteObjects(toDelete);
}
```

---

## 後台 API 設計建議

```typescript
// 文章 CRUD
POST   /api/articles           // 新增文章
GET    /api/articles           // 列表（支援分頁、篩選）
GET    /api/articles/:id       // 取得單篇
PUT    /api/articles/:id       // 更新文章
DELETE /api/articles/:id       // 刪除文章

// 發布控制
POST   /api/articles/:id/publish   // 發布文章
POST   /api/articles/:id/unpublish // 下架文章

// 分類/主題/標籤管理
GET    /api/categories
POST   /api/categories
GET    /api/topics
POST   /api/topics
GET    /api/tags
POST   /api/tags
```

---

## Algolia Dashboard 設定

### Searchable Attributes
```
hierarchy.lvl0
hierarchy.lvl1
hierarchy.lvl2
content
tags
```

### Custom Ranking
```
desc(publishedAtTimestamp)  // 最新文章優先
```

### Facets（篩選用）
```
categoryName
topicName
tags
```

### Synonyms（同義詞，提升搜尋體驗）
```
Angular, ng
JavaScript, JS
TypeScript, TS
演算法, algorithm
資料結構, data structure
```

---

## 注意事項

1. **ID 格式**：建議使用 UUID 或 CUID，避免自增 ID 暴露資料量
2. **Slug 唯一性**：URL slug 必須全域唯一，建議加上日期前綴如 `2024-12-angular-signals`
3. **軟刪除**：考慮用 `deletedAt` 欄位取代真刪除
4. **版本控制**：重要內容可加 `version` 欄位追蹤修改歷史
5. **快取策略**：Algolia 搜尋結果可搭配 CDN 快取降低請求數
