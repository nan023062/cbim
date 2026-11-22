import { ScrollWindow } from '../containers/ScrollWindow';
import type { ComponentPropsWithRef } from 'react';

export function Input(props: ComponentPropsWithRef<'input'>) {
  return <input {...props} />;
}

export function TextArea(props: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...ScrollWindow.native} {...props} />;
}

export function Select(props: ComponentPropsWithRef<'select'>) {
  return <select data-ui-select={props.multiple || (props.size ?? 0) > 1 ? undefined : ''} {...ScrollWindow.native} {...props} />;
}

export function Option(props: ComponentPropsWithRef<'option'>) {
  return <option {...props} />;
}

export function FieldLabel(props: ComponentPropsWithRef<'label'>) {
  return <label {...props} />;
}

export function Form(props: ComponentPropsWithRef<'form'>) {
  return <form {...props} />;
}

export function FieldGroup(props: ComponentPropsWithRef<'fieldset'>) {
  return <fieldset {...props} />;
}

export function FieldLegend(props: ComponentPropsWithRef<'legend'>) {
  return <legend {...props} />;
}

export function Progress(props: ComponentPropsWithRef<'progress'>) {
  return <progress {...props} />;
}

export function Disclosure(props: ComponentPropsWithRef<'details'>) {
  return <details {...props} />;
}

export function DisclosureSummary(props: ComponentPropsWithRef<'summary'>) {
  return <summary {...props} />;
}

export function Checkbox(props: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <input {...props} type="checkbox" />;
}
