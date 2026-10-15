import { Component } from '@angular/core';

@Component({
  standalone: false,
  template: `
    <h1>{{ 'errors.401.title' | translate }}</h1>
    <p>{{ 'errors.401.description' | translate }}</p>
  `,
})
export class E401Component {}
