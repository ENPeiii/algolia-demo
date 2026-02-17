import {
  Component,
  ChangeDetectionStrategy,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  viewChild,
  PLATFORM_ID,
  inject,
  input,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #searchContainer></div>`,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class SearchComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly searchContainer = viewChild<ElementRef>('searchContainer');
  private instance: { destroy?: () => void } | null = null;

  // 可透過 input 自訂設定
  readonly appId = input('H737UJMUXH');
  readonly apiKey = input('3b1282e0043fa69de45e9cde4cf81623');
  readonly indexName = input('algolia-demo');
  readonly placeholder = input('Search documentation');

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const container = this.searchContainer()?.nativeElement;
    if (!container) return;

    try {
      // 動態載入 DocSearch JS
      const docsearchModule = await import('@docsearch/js');
      const docsearch = docsearchModule.default;

      // 初始化 DocSearch
      this.instance = docsearch({
        appId: this.appId(),
        apiKey: this.apiKey(),
        indexName: this.indexName(),
        container,
        placeholder: this.placeholder(),
        searchParameters: {
          hitsPerPage: 10,
        },
        transformItems: (items: any[]) => {
          return items.map((item) => {
            const lvl0 = item.hierarchy?.lvl0 || '';
            const lvl1 = item.hierarchy?.lvl1 || '';
            
            // 組合完整階層路徑：技術文 › Leetcode 刷題
            const breadcrumb = lvl1 && lvl1 !== '一般文章' 
              ? `${lvl0} › ${lvl1}` 
              : lvl0;

            return {
              ...item,
              url: item.url || `#${item.objectID}`,
              hierarchy: {
                ...item.hierarchy,
                // 用 lvl1 顯示完整路徑
                lvl1: breadcrumb,
              },
            };
          });
        },
      }) as { destroy?: () => void };
    } catch (error) {
      console.error('Failed to initialize DocSearch:', error);
    }
  }

  ngOnDestroy(): void {
    this.instance?.destroy?.();
  }
}
