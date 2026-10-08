/**
 * 离线 Mock 的演示课程教材目录——从 V6__course_textbook_graph.sql 的种子数据逐条生成，并应用
 * V7 的 4.8 修正；catalog.contract.test.ts 会重新解析这两份 SQL 并逐字段比对，任何一边漂移都会失败。
 *
 * 全部是虚构的演示数据：课程名带「演示课程」前缀，教师为「演示教师」。演示教材一律「无 ISBN」，
 * 用书目信息指纹去重——不占用任何真实书号，也不再把 979-0（乐谱号 ISMN）当作图书 ISBN 展示。
 * 不代表任何真实学校，不来自任何教务系统。
 */
import type { Campus } from '../types';
import type { Term, TextbookUsage } from '../api/contracts';

export interface MockCourse { id: string; schoolId: string; courseCode: string | null; name: string; normalizedName: string; department: string | null; isDemo: boolean; active?: boolean }
export interface MockOffering { id: string; courseId: string; schoolId: string; academicYear: string; term: Term; instructorName: string | null; campusId: Campus | null; active?: boolean }
export interface MockEdition {
  id: string; schoolId: string; isbn10?: string | null; isbn13: string | null; normalizedIsbn: string | null; title: string; subtitle?: string | null;
  authors: string[]; publisher: string; editionLabel: string; publishedYear: number | null; workKey: string | null;
  noIsbnFingerprint: string | null; isDemo: boolean; coverUrl?: string | null; active?: boolean;
}
export interface MockCourseTextbook { courseOfferingId: string; textbookEditionId: string; schoolId: string; usageType: TextbookUsage; verificationStatus: 'VERIFIED' | 'PENDING' | 'REJECTED'; sourceNote: string | null }

export const seedCourses: MockCourse[] = [
  {
    "id": "demo-calculus-1",
    "schoolId": "pilot",
    "courseCode": "DEMO-MA101",
    "name": "演示课程·微积分（一）",
    "normalizedName": "演示课程·微积分（一）",
    "department": "演示数学学院",
    "isDemo": true
  },
  {
    "id": "demo-linear-algebra",
    "schoolId": "pilot",
    "courseCode": "DEMO-MA102",
    "name": "演示课程·线性代数",
    "normalizedName": "演示课程·线性代数",
    "department": "演示数学学院",
    "isDemo": true
  },
  {
    "id": "demo-physics-1",
    "schoolId": "pilot",
    "courseCode": "DEMO-PH101",
    "name": "演示课程·大学物理（上）",
    "normalizedName": "演示课程·大学物理（上）",
    "department": "演示物理学院",
    "isDemo": true
  },
  {
    "id": "demo-programming",
    "schoolId": "pilot",
    "courseCode": "DEMO-CS101",
    "name": "演示课程·程序设计基础",
    "normalizedName": "演示课程·程序设计基础",
    "department": "演示计算机学院",
    "isDemo": true
  },
  {
    "id": "demo-academic-en",
    "schoolId": "pilot",
    "courseCode": "DEMO-EN101",
    "name": "演示课程·学术英语写作",
    "normalizedName": "演示课程·学术英语写作",
    "department": "演示外国语学院",
    "isDemo": true
  }
];

export const seedOfferings: MockOffering[] = [
  {
    "id": "demo-calculus-1-2025s",
    "courseId": "demo-calculus-1",
    "schoolId": "pilot",
    "academicYear": "2025-2026",
    "term": "SPRING",
    "instructorName": "演示教师甲",
    "campusId": "东校区"
  },
  {
    "id": "demo-calculus-1-2026a",
    "courseId": "demo-calculus-1",
    "schoolId": "pilot",
    "academicYear": "2026-2027",
    "term": "AUTUMN",
    "instructorName": "演示教师甲",
    "campusId": "东校区"
  },
  {
    "id": "demo-linear-algebra-2026a",
    "courseId": "demo-linear-algebra",
    "schoolId": "pilot",
    "academicYear": "2026-2027",
    "term": "AUTUMN",
    "instructorName": "演示教师乙",
    "campusId": "西校区"
  },
  {
    "id": "demo-physics-1-2026a",
    "courseId": "demo-physics-1",
    "schoolId": "pilot",
    "academicYear": "2026-2027",
    "term": "AUTUMN",
    "instructorName": "演示教师丙",
    "campusId": "东校区"
  },
  {
    "id": "demo-programming-2026a",
    "courseId": "demo-programming",
    "schoolId": "pilot",
    "academicYear": "2026-2027",
    "term": "AUTUMN",
    "instructorName": null,
    "campusId": null
  },
  {
    "id": "demo-academic-en-2026a",
    "courseId": "demo-academic-en",
    "schoolId": "pilot",
    "academicYear": "2026-2027",
    "term": "AUTUMN",
    "instructorName": "演示教师丁",
    "campusId": "南校区"
  }
];

export const seedEditions: MockEdition[] = [
  {
    "id": "demo-calculus-7",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "微积分教程（演示）",
    "authors": [
      "演示作者甲"
    ],
    "publisher": "演示大学出版社",
    "editionLabel": "第 7 版",
    "publishedYear": 2023,
    "workKey": "demo-calculus",
    "noIsbnFingerprint": "b0491ddffbdf8df07787d72771ac230a9cf46a8e0d94a7fe002a58134b75a096",
    "isDemo": true
  },
  {
    "id": "demo-calculus-8",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "微积分教程（演示）",
    "authors": [
      "演示作者甲"
    ],
    "publisher": "演示大学出版社",
    "editionLabel": "第 8 版",
    "publishedYear": 2025,
    "workKey": "demo-calculus",
    "noIsbnFingerprint": "a6abb0d95ac7ff36b652e3b78bc3d38379c78cfc0128cdc1bb2f25ba94da0652",
    "isDemo": true
  },
  {
    "id": "demo-linear-algebra-3",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "线性代数导论（演示）",
    "authors": [
      "演示作者乙",
      "演示作者丙"
    ],
    "publisher": "演示科技出版社",
    "editionLabel": "第 3 版",
    "publishedYear": 2024,
    "workKey": "demo-linear-algebra",
    "noIsbnFingerprint": "0c2a02ec3f98cd15327a6a01bbbdeb2ead22db43f01f61c39150ab908abc1dc4",
    "isDemo": true
  },
  {
    "id": "demo-physics-5",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "大学物理（演示）· 上册",
    "authors": [
      "演示作者丁"
    ],
    "publisher": "演示大学出版社",
    "editionLabel": "第 5 版",
    "publishedYear": 2022,
    "workKey": "demo-physics",
    "noIsbnFingerprint": "87ebdb39e2f952f25b8e6ec44fab0d4b2c00ec6fac1d94b9df102d7bb9fa18f3",
    "isDemo": true
  },
  {
    "id": "demo-programming-2",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "程序设计基础（演示）",
    "authors": [
      "演示作者戊"
    ],
    "publisher": "演示科技出版社",
    "editionLabel": "第 2 版",
    "publishedYear": 2024,
    "workKey": null,
    "noIsbnFingerprint": "7d069ad9d545052de74e34f277f4b1b44a6018c2a03f4800dabf76b02d715fd6",
    "isDemo": true
  },
  {
    "id": "demo-academic-en-notes",
    "schoolId": "pilot",
    "isbn13": null,
    "normalizedIsbn": null,
    "title": "学术英语写作讲义（演示）",
    "authors": [
      "演示作者己"
    ],
    "publisher": "演示外国语学院（自编）",
    "editionLabel": "2026 秋季版",
    "publishedYear": 2026,
    "workKey": null,
    "noIsbnFingerprint": "0e545530b8a179820bb31f0df6a5927c93106a0da338d36670439b4ff8f3e48a",
    "isDemo": true
  }
];

export const seedCourseTextbooks: MockCourseTextbook[] = [
  {
    "courseOfferingId": "demo-calculus-1-2025s",
    "textbookEditionId": "demo-calculus-7",
    "schoolId": "pilot",
    "usageType": "REQUIRED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-calculus-1-2026a",
    "textbookEditionId": "demo-calculus-8",
    "schoolId": "pilot",
    "usageType": "REQUIRED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-calculus-1-2026a",
    "textbookEditionId": "demo-calculus-7",
    "schoolId": "pilot",
    "usageType": "REFERENCE",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-linear-algebra-2026a",
    "textbookEditionId": "demo-linear-algebra-3",
    "schoolId": "pilot",
    "usageType": "REQUIRED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-physics-1-2026a",
    "textbookEditionId": "demo-physics-5",
    "schoolId": "pilot",
    "usageType": "REQUIRED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-programming-2026a",
    "textbookEditionId": "demo-programming-2",
    "schoolId": "pilot",
    "usageType": "RECOMMENDED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  },
  {
    "courseOfferingId": "demo-academic-en-2026a",
    "textbookEditionId": "demo-academic-en-notes",
    "schoolId": "pilot",
    "usageType": "REQUIRED",
    "verificationStatus": "VERIFIED",
    "sourceNote": "演示数据：虚构，不来自任何学校教务系统"
  }
];
