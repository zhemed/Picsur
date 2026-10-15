import { Component } from '@angular/core';

@Component({
  template: `
    <h1>{{ 'errors.404.title' | translate }}</h1>
    <p>{{ 'errors.404.description' | translate }}</p>
  `,
})
export class E404Component {}
