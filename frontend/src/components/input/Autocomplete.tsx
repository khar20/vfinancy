import * as React from 'react';
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete';
import { ChevronDown } from 'lucide-react';
import { cx } from '@/utils/cx';

export const Autocomplete = AutocompletePrimitive.Root;
export const AutocompleteList = AutocompletePrimitive.List;

export const AutocompleteInputGroup = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.InputGroup>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.InputGroup>, 'className'> & { className?: string }
>(({ className, ...props }, ref) => (
  <AutocompletePrimitive.InputGroup ref={ref} className={cx('input-affix', className)} {...props} />
));
AutocompleteInputGroup.displayName = 'AutocompleteInputGroup';

export const AutocompleteInput = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.Input>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Input>, 'className'> & {
    className?: string;
    invalid?: boolean;
  }
>(({ className, invalid, ...props }, ref) => (
  <AutocompletePrimitive.Input ref={ref} className={cx('input', invalid && 'input--invalid', className)} {...props} />
));
AutocompleteInput.displayName = 'AutocompleteInput';

export const AutocompleteTrigger = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.Trigger>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Trigger>, 'className'> & { className?: string }
>(({ className, children, ...props }, ref) => (
  <AutocompletePrimitive.Trigger
    ref={ref}
    type="button"
    className={cx('input-affix__action', className)}
    aria-label="Mostrar conceptos"
    {...props}
  >
    {children}
    <ChevronDown />
  </AutocompletePrimitive.Trigger>
));
AutocompleteTrigger.displayName = 'AutocompleteTrigger';

export const AutocompleteContent = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.Popup>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Popup>, 'className'> & {
    className?: string;
    align?: React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Positioner>['align'];
    sideOffset?: number;
  }
>(({ className, children, align = 'start', sideOffset = 8, ...props }, ref) => (
  <AutocompletePrimitive.Portal>
    <AutocompletePrimitive.Positioner align={align} sideOffset={sideOffset} className="select-positioner">
      <AutocompletePrimitive.Popup ref={ref} className={cx('select-popup', className)} {...props}>
        {children}
      </AutocompletePrimitive.Popup>
    </AutocompletePrimitive.Positioner>
  </AutocompletePrimitive.Portal>
));
AutocompleteContent.displayName = 'AutocompleteContent';

export const AutocompleteItem = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.Item>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Item>, 'className'> & { className?: string }
>(({ className, ...props }, ref) => (
  <AutocompletePrimitive.Item ref={ref} className={cx('select-item', className)} {...props} />
));
AutocompleteItem.displayName = 'AutocompleteItem';

export const AutocompleteEmpty = React.forwardRef<
  React.ComponentRef<typeof AutocompletePrimitive.Empty>,
  Omit<React.ComponentPropsWithoutRef<typeof AutocompletePrimitive.Empty>, 'className'> & { className?: string }
>(({ className, children, ...props }, ref) => (
  <AutocompletePrimitive.Empty ref={ref} className={cx('select-empty', className)} {...props}>
    {children}
  </AutocompletePrimitive.Empty>
));
AutocompleteEmpty.displayName = 'AutocompleteEmpty';
