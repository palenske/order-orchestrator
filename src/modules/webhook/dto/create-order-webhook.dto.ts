import {
  IsString,
  IsEmail,
  IsNumber,
  IsArray,
  Min,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomerDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;
}

export class OrderItemDto {
  @IsString()
  sku: string;

  @IsNumber()
  @Min(1)
  qty: number;

  @IsNumber()
  unit_price: number;
}

export class CreateOrderWebhookDto {
  @IsString()
  order_id: string;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  currency: string;

  @IsString()
  idempotency_key: string;
}
